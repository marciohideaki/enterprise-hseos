/**
 * Platform bindings loader tests (ADR-0046)
 *
 * Validates the layered bindings documents, precedence, anti-downgrade rules,
 * registry resolution, stack detection and the atomic project writer.
 */

const path = require('node:path');
const os = require('node:os');
const fs = require('fs-extra');
const yaml = require('yaml');
const {
  PLATFORM_MODES,
  detectStacks,
  loadPlatformBindings,
  modeStrength,
  parsePlatformBindingFlag,
  validateBindingsDocument,
  writePlatformBindings,
} = require('../tools/cli/lib/platform-bindings');

const REPO_ROOT = path.join(__dirname, '..');
const VECTORS = fs.readJsonSync(path.join(REPO_ROOT, 'test', 'fixtures', 'platform-bindings', 'vectors.json'));
const NOW = new Date('2026-10-01T12:00:00Z');

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

function throwsWith(fn, fragment) {
  try {
    fn();
  } catch (error) {
    return error.message.includes(fragment) ? true : error.message;
  }
  return 'did not throw';
}

function sandbox() {
  const tmpRoot = process.env.TMPDIR || os.tmpdir();
  const base = fs.mkdtempSync(path.join(tmpRoot, 'hseos-bindings-'));
  const dirs = {
    base,
    project: path.join(base, 'project'),
    home: path.join(base, 'home'),
    xdg: path.join(base, 'xdg'),
    runtime: path.join(base, 'runtime'),
  };
  for (const dir of [dirs.project, dirs.home, dirs.xdg, dirs.runtime]) fs.mkdirSync(dir, { recursive: true });
  dirs.env = { HOME: dirs.home, XDG_CONFIG_HOME: dirs.xdg };
  dirs.cleanup = () => fs.removeSync(base);
  return dirs;
}

function writeYaml(file, doc) {
  fs.ensureDirSync(path.dirname(file));
  fs.writeFileSync(file, yaml.stringify(doc));
}

const projectFile = (sb) => path.join(sb.project, '.hseos', 'config', 'platform-bindings.yaml');
const userFile = (sb) => path.join(sb.xdg, 'hseos', 'platform-bindings.yaml');
// baseMode defaults to the weakest mode so cases isolate one rule; downgrade cases pass baseMode explicitly.
const load = (sb, extra = {}) =>
  loadPlatformBindings({ runtimeRoot: sb.runtime, projectDir: sb.project, env: sb.env, now: NOW, baseMode: 'local', ...extra });
const writeProject = (sb, doc) => writeYaml(projectFile(sb), { schema_version: '1.0.0', ...doc });
const writeDecision = (sb, rel = 'docs/decisions/local.md') => {
  fs.ensureDirSync(path.dirname(path.join(sb.project, rel)));
  fs.writeFileSync(path.join(sb.project, rel), '# decision\n');
  return rel;
};

function testModes() {
  console.log('\nModes');
  assertPass('PLATFORM_MODES order', PLATFORM_MODES.join(',') === 'platform,hybrid,local');
  assertPass('mode strength ordering', modeStrength('platform') > modeStrength('hybrid') && modeStrength('hybrid') > modeStrength('local'));
  assertPass('unknown mode has no strength', modeStrength('off') === 0);
}

function testVectors() {
  console.log('\nVectors');
  for (const [index, doc] of VECTORS.valid.entries()) {
    let ok = true;
    let detail = '';
    try {
      validateBindingsDocument(doc, { layer: 'user', now: NOW });
    } catch (error) {
      ok = false;
      detail = error.message;
    }
    assertPass(`valid vector ${index} (user layer)`, ok, detail);
  }
  for (const [index, doc] of VECTORS.invalid.entries()) {
    const result = throwsWith(() => validateBindingsDocument(doc, { layer: 'user', now: NOW }), 'Invalid platform bindings (user)');
    assertPass(`invalid vector ${index} rejected`, result === true, String(result));
  }
}

function testLayerRules() {
  console.log('\nLayer rules');
  const base = { schema_version: '1.0.0' };
  assertPass('unknown layer rejected', throwsWith(() => validateBindingsDocument(base, { layer: 'other' }), 'unknown layer') === true);
  assertPass('missing layer rejected', throwsWith(() => validateBindingsDocument(base), 'unknown layer') === true);
  assertPass('non-object rejected', throwsWith(() => validateBindingsDocument([], { layer: 'user' }), 'must be an object') === true);
  assertPass('project requires mode', throwsWith(() => validateBindingsDocument(base, { layer: 'project' }), 'must declare mode') === true);
  assertPass('project accepts mode', validateBindingsDocument({ ...base, mode: 'platform' }, { layer: 'project' }) !== undefined);
  assertPass(
    'project forbids workspace',
    throwsWith(
      () => validateBindingsDocument({ ...base, mode: 'platform', workspace: { ecp_root: '/x' } }, { layer: 'project' }),
      'workspace',
    ) === true,
  );
  assertPass(
    'user accepts workspace',
    validateBindingsDocument({ ...base, workspace: { ecp_root: '/x' } }, { layer: 'user' }) !== undefined,
  );
  assertPass(
    'runtime forbids workspace',
    throwsWith(() => validateBindingsDocument({ ...base, workspace: { ecp_root: '/x' } }, { layer: 'runtime' }), 'workspace') === true,
  );
  assertPass(
    'runtime forbids mode',
    throwsWith(() => validateBindingsDocument({ ...base, mode: 'platform' }, { layer: 'runtime' }), 'must not set mode') === true,
  );
  for (const ref of ['/abs/decision.md', 'a/../b.md', '../x.md', 'C:/x.md', String.raw`a\b.md`]) {
    const doc = { ...base, mode: 'local', mode_ref: ref };
    assertPass(`mode_ref '${ref}' rejected`, throwsWith(() => validateBindingsDocument(doc, { layer: 'project' }), 'mode_ref') === true);
  }
  const override = { capability: 'cache.typed', outcome: 'keep-local', intake_ref: 'INTAKE-1', reason: 'r' };
  const withExpiry = (expires, extra = {}) => ({ ...base, overrides: [{ ...override, expires, ...extra }] });
  assertPass(
    'override expiring today is valid',
    validateBindingsDocument(withExpiry('2026-10-01'), { layer: 'user', now: NOW }) !== undefined,
  );
  assertPass(
    'expired override invalid',
    throwsWith(() => validateBindingsDocument(withExpiry('2026-09-30'), { layer: 'user', now: NOW }), 'has passed') === true,
  );
  assertPass(
    'impossible date invalid',
    throwsWith(() => validateBindingsDocument(withExpiry('2026-02-30'), { layer: 'user', now: NOW }), 'real calendar date') === true,
  );
  assertPass(
    'absolute intake_ref invalid',
    throwsWith(
      () => validateBindingsDocument(withExpiry('2027-01-01', { intake_ref: '/etc/x' }), { layer: 'user', now: NOW }),
      'intake_ref',
    ) === true,
  );
  assertPass(
    'dotdot exception_ref invalid',
    throwsWith(
      () =>
        validateBindingsDocument(
          {
            ...base,
            overrides: [{ ...override, outcome: 'exception', intake_ref: undefined, exception_ref: '../x', expires: '2027-01-01' }],
          },
          { layer: 'user', now: NOW },
        ),
      'exception_ref',
    ) === true,
  );
  assertPass(
    'mismatched ref key invalid',
    throwsWith(
      () => validateBindingsDocument(withExpiry('2027-01-01', { exception_ref: 'EXC-1' }), { layer: 'user', now: NOW }),
      'not allowed',
    ) === true,
  );
  assertPass(
    'duplicate override capability invalid',
    throwsWith(
      () =>
        validateBindingsDocument(
          {
            ...base,
            overrides: [
              { ...override, expires: '2027-01-01' },
              { ...override, expires: '2027-01-01' },
            ],
          },
          { layer: 'user', now: NOW },
        ),
      'more than once',
    ) === true,
  );
  assertPass(
    'overrides must be a list',
    throwsWith(() => validateBindingsDocument({ ...base, overrides: {} }, { layer: 'user' }), 'must be a list') === true,
  );
  assertPass(
    'override must be an object',
    throwsWith(() => validateBindingsDocument({ ...base, overrides: ['x'] }, { layer: 'user' }), 'must be an object') === true,
  );
  assertPass(
    'unknown override outcome invalid',
    throwsWith(() => validateBindingsDocument(withExpiry('2027-01-01', { outcome: 'ignore' }), { layer: 'user', now: NOW }), 'outcome') ===
      true,
  );
  assertPass(
    'empty reason invalid',
    throwsWith(() => validateBindingsDocument(withExpiry('2027-01-01', { reason: ' ' }), { layer: 'user', now: NOW }), 'reason') === true,
  );
  assertPass(
    'registry must be an object',
    throwsWith(() => validateBindingsDocument({ ...base, registry: 'x' }, { layer: 'user' }), 'registry must be an object') === true,
  );
  assertPass(
    'registry unknown source invalid',
    throwsWith(() => validateBindingsDocument({ ...base, registry: { source: 'git' } }, { layer: 'user' }), 'registry.source') === true,
  );
  assertPass(
    'registry empty path invalid',
    throwsWith(() => validateBindingsDocument({ ...base, registry: { source: 'path', path: '' } }, { layer: 'user' }), 'registry.path') ===
      true,
  );
  assertPass(
    'workspace must be an object',
    throwsWith(() => validateBindingsDocument({ ...base, workspace: 'x' }, { layer: 'user' }), 'workspace must be an object') === true,
  );
  assertPass(
    'workspace unknown key invalid',
    throwsWith(() => validateBindingsDocument({ ...base, workspace: { other: '/x' } }, { layer: 'user' }), 'unknown field') === true,
  );
  assertPass(
    'workspace empty value invalid',
    throwsWith(() => validateBindingsDocument({ ...base, workspace: { ecp_root: '' } }, { layer: 'user' }), 'workspace.ecp_root') === true,
  );
  assertPass(
    'stacks must be ids',
    throwsWith(() => validateBindingsDocument({ ...base, stacks: ['Bad Stack'] }, { layer: 'user' }), 'not a valid stack id') === true,
  );
  assertPass(
    'stacks reject duplicates',
    throwsWith(() => validateBindingsDocument({ ...base, stacks: ['node', 'node'] }, { layer: 'user' }), 'duplicate') === true,
  );
  for (const id of ['INTAKE 1', '.hidden', '-x', 'a/b', 'a:b']) {
    const doc = { ...base, overrides: [{ ...override, intake_ref: id, expires: '2027-01-01' }] };
    assertPass(
      `intake_ref id '${id}' rejected`,
      throwsWith(() => validateBindingsDocument(doc, { layer: 'user', now: NOW }), 'must be an identifier') === true,
    );
  }
  assertPass(
    'project layer rejects absolute registry.path',
    throwsWith(
      () => validateBindingsDocument({ ...base, mode: 'platform', registry: { source: 'path', path: '/x' } }, { layer: 'project' }),
      'absolute',
    ) === true,
  );
  const multi = throwsWith(() => validateBindingsDocument({ schema_version: '2', mode: 'x', extra: 1 }, { layer: 'user' }), ';');
  assertPass('all problems reported together', multi === true, String(multi));
}

function testNoFileAndInvalidFile() {
  console.log('\nNo file and invalid file');
  const sb = sandbox();
  try {
    writeYaml(path.join(sb.runtime, '.enterprise/governance/capabilities/platform-bindings.defaults.yaml'), {
      schema_version: '1.0.0',
      registry: { source: 'snapshot' },
    });
    let result = load(sb);
    assertPass(
      'no project file -> platform/default-no-file',
      result.mode === 'platform' && result.source === 'default-no-file' && result.errors.length === 0,
    );
    assertPass('no file: registry from runtime defaults', result.registry.source === 'snapshot');

    fs.ensureDirSync(path.dirname(projectFile(sb)));
    fs.writeFileSync(projectFile(sb), 'schema_version: 1.0.0\nmode: off\n');
    result = load(sb);
    assertPass(
      'invalid file -> platform + error recorded',
      result.mode === 'platform' &&
        result.source === 'invalid-file' &&
        /project file: Invalid platform bindings \(project\)/.test(result.errors[0] || ''),
    );

    fs.writeFileSync(projectFile(sb), 'a: [unclosed\n');
    result = load(sb);
    assertPass(
      'unparseable file -> platform/invalid-file',
      result.mode === 'platform' && result.source === 'invalid-file' && result.errors.length === 1,
    );

    fs.writeFileSync(projectFile(sb), '');
    result = load(sb);
    assertPass('empty file -> invalid-file', result.source === 'invalid-file');

    writeProject(sb, { mode: 'hybrid', mode_ref: 'docs/decisions/missing.md' });
    result = load(sb);
    assertPass('missing mode_ref -> invalid-file', result.source === 'invalid-file' && /does not exist/.test(result.errors[0]));

    writeProject(sb, { mode: 'hybrid' });
    result = load(sb);
    assertPass('hybrid project file honored', result.mode === 'hybrid' && result.source === 'project' && result.errors.length === 0);

    writeProject(sb, { mode: 'platform', workspace: { ecp_root: '/x' } });
    result = load(sb);
    assertPass('workspace in project file -> invalid-file', result.source === 'invalid-file' && result.workspace.ecp_root === undefined);
    assertPass('runtimeRoot is optional', loadPlatformBindings({ projectDir: sb.project, env: sb.env, now: NOW }).mode === 'platform');
    assertPass(
      'missing runtime defaults file is tolerated',
      load(sb, { runtimeRoot: path.join(sb.base, 'nope') }).errors.every((e) => !e.startsWith('runtime defaults')),
    );
    fs.writeFileSync(
      path.join(sb.runtime, '.enterprise/governance/capabilities/platform-bindings.defaults.yaml'),
      'schema_version: 1.0.0\nmode: local\nmode_ref: docs/decisions/local.md\n',
    );
    result = load(sb);
    assertPass(
      'runtime defaults cannot set mode',
      result.errors.some((e) => e.startsWith('runtime defaults:')) && result.mode === 'platform',
    );
    assertPass('projectDir required', throwsWith(() => loadPlatformBindings({}), 'projectDir') === true);
    assertPass(
      'invalid baseMode rejected',
      throwsWith(() => loadPlatformBindings({ projectDir: sb.project, baseMode: 'off' }), 'baseMode') === true,
    );
  } finally {
    sb.cleanup();
  }
}

function testWeakeningRules() {
  console.log('\nAnti-downgrade');
  const sb = sandbox();
  try {
    writeProject(sb, { mode: 'hybrid' });
    writeYaml(userFile(sb), { schema_version: '1.0.0', mode: 'local', mode_ref: 'docs/decisions/local.md' });
    let result = load(sb);
    assertPass('user layer cannot weaken project mode', result.mode === 'hybrid' && result.warnings.some((w) => /cannot weaken/.test(w)));

    writeYaml(userFile(sb), { schema_version: '1.0.0', mode: 'platform' });
    result = load(sb);
    assertPass('user layer can strengthen', result.mode === 'platform' && result.source === 'user');

    writeYaml(userFile(sb), { schema_version: '1.0.0', mode: 'hybrid' });
    assertPass('equal user mode keeps project source', load(sb).source === 'project');
    fs.removeSync(userFile(sb));

    const envFile = path.join(sb.base, 'env-bindings.yaml');
    writeYaml(envFile, { schema_version: '1.0.0', mode: 'local', mode_ref: 'docs/decisions/local.md' });
    result = load(sb, { env: { ...sb.env, HSEOS_PLATFORM_BINDINGS: envFile } });
    assertPass('HSEOS_PLATFORM_BINDINGS cannot weaken', result.mode === 'hybrid');
    writeYaml(envFile, { schema_version: '1.0.0', mode: 'platform' });
    assertPass(
      'HSEOS_PLATFORM_BINDINGS can strengthen',
      load(sb, { env: { ...sb.env, HSEOS_PLATFORM_BINDINGS: envFile } }).mode === 'platform',
    );
    result = load(sb, { env: { ...sb.env, HSEOS_PLATFORM_BINDINGS: path.join(sb.base, 'absent.yaml') } });
    assertPass(
      'missing HSEOS_PLATFORM_BINDINGS file warns',
      result.warnings.some((w) => /does not exist/.test(w)) && result.mode === 'hybrid',
    );
    fs.writeFileSync(envFile, 'mode: [');
    result = load(sb, { env: { ...sb.env, HSEOS_PLATFORM_BINDINGS: envFile } });
    assertPass(
      'invalid user layer recorded and ignored',
      result.errors.some((e) => e.startsWith('user layer:')) && result.mode === 'hybrid',
    );

    result = load(sb, { flags: { mode: 'platform' } });
    assertPass('flag can strengthen', result.mode === 'platform' && result.source === 'flags');
    result = load(sb, { flags: { mode: 'hybrid' } });
    assertPass('flag equal to project keeps project source', result.source === 'project');
    result = load(sb, { flags: { mode: 'local' } });
    assertPass('flag cannot weaken without modeRef', result.mode === 'hybrid' && result.errors.some((e) => /requires --mode-ref/.test(e)));
    result = load(sb, { flags: { mode: 'local', modeRef: 'docs/decisions/absent.md' } });
    assertPass('flag modeRef must exist', result.mode === 'hybrid' && result.errors.length === 1);
    result = load(sb, { flags: { mode: 'local', modeRef: '../escape.md' } });
    assertPass('flag modeRef cannot escape', result.mode === 'hybrid' && result.errors.length === 1);
    const ref = writeDecision(sb);
    result = load(sb, { flags: { mode: 'local', modeRef: ref } });
    assertPass('flag may weaken with existing modeRef', result.mode === 'local' && result.source === 'flags' && result.modeRef === ref);
    result = load(sb, { flags: { mode: 'off' } });
    assertPass('unknown flag mode recorded', result.mode === 'hybrid' && result.errors.length === 1);
    result = load(sb, { flags: { modeRef: ref } });
    assertPass(
      'modeRef without mode warns',
      result.warnings.some((w) => /--mode-ref ignored/.test(w)),
    );

    result = load(sb, { baseMode: 'platform' });
    assertPass(
      'downgrade vs baseMode without mode_ref rejected',
      result.mode === 'platform' && result.source === 'downgrade-rejected' && result.errors.length === 1,
    );
    assertPass('same mode as baseMode is fine', load(sb, { baseMode: 'hybrid' }).errors.length === 0);
    writeProject(sb, { mode: 'hybrid', mode_ref: ref });
    result = load(sb, { baseMode: 'platform' });
    assertPass(
      'downgrade vs baseMode with an existing but uncommitted mode_ref rejected (D6; the full matrix is in test-platform-bindings-downgrade.js)',
      result.mode === 'platform' && result.source === 'downgrade-rejected' && /not committed|git failed/.test(result.errors.join(' ')),
    );
    writeProject(sb, { mode: 'local', mode_ref: ref });
    assertPass('local with existing mode_ref accepted', load(sb).mode === 'local');
    result = load(sb, { flags: { mode: 'hybrid' } });
    assertPass('flag may strengthen local', result.mode === 'hybrid' && result.modeRef === null);

    fs.removeSync(projectFile(sb));
    result = load(sb, { flags: { mode: 'local', modeRef: ref } });
    assertPass('no project file: flags weaken only with modeRef', result.mode === 'local' && result.source === 'flags');
    assertPass('no project file: flags cannot weaken bare', load(sb, { flags: { mode: 'hybrid' } }).mode === 'platform');

    fs.ensureDirSync(path.join(sb.project, 'docs', 'decisions', 'dir.md'));
    writeProject(sb, { mode: 'local', mode_ref: 'docs/decisions/dir.md' });
    assertPass('mode_ref directory is not a file', load(sb).source === 'invalid-file');
    const outside = path.join(sb.base, 'outside.md');
    fs.writeFileSync(outside, 'x');
    fs.symlinkSync(outside, path.join(sb.project, 'docs', 'decisions', 'link.md'));
    writeProject(sb, { mode: 'local', mode_ref: 'docs/decisions/link.md' });
    assertPass('mode_ref symlink escaping the repo rejected', load(sb).source === 'invalid-file');
  } finally {
    sb.cleanup();
  }
}

function testOverrides() {
  console.log('\nOverrides');
  const sb = sandbox();
  try {
    const projectOverride = {
      capability: 'cache.typed',
      outcome: 'keep-local',
      intake_ref: 'INTAKE-1',
      reason: 'latency',
      expires: '2027-03-31',
    };
    writeProject(sb, { mode: 'hybrid', overrides: [projectOverride] });
    let result = load(sb);
    assertPass(
      'unrecorded intake_ref invalidates the file',
      result.source === 'invalid-file' && /not recorded in the repository/.test(result.errors[0]),
    );

    writeDecision(sb, 'docs/decisions/2026-10-intake-cache.md');
    fs.appendFileSync(path.join(sb.project, 'docs/decisions/2026-10-intake-cache.md'), 'Accepted: INTAKE-1 (cache)\n');
    result = load(sb);
    assertPass('intake_ref resolved in docs/decisions/*intake*.md', result.source === 'project' && result.overrides[0].layer === 'project');

    fs.writeFileSync(path.join(sb.project, 'docs/decisions/2026-10-intake-cache.md'), 'only INTAKE-10 here\n');
    assertPass('intake_ref requires a whole-token match', load(sb).source === 'invalid-file');
    fs.ensureDirSync(path.join(sb.project, 'docs/decisions/nested'));
    fs.writeFileSync(path.join(sb.project, 'docs/decisions/nested/Team-INTAKE-log.md'), 'ref=INTAKE-1.\n');
    assertPass('intake_ref found in nested, case-insensitive file name', load(sb).source === 'project');
    fs.writeFileSync(path.join(sb.project, 'docs/decisions/nested/other.md'), 'INTAKE-1\n');
    fs.removeSync(path.join(sb.project, 'docs/decisions/nested/Team-INTAKE-log.md'));
    assertPass('intake_ref in a non-intake file does not count', load(sb).source === 'invalid-file');

    fs.writeFileSync(path.join(sb.project, 'docs/decisions/nested/Team-INTAKE-log.md'), 'INTAKE-1\n');
    writeYaml(userFile(sb), { schema_version: '1.0.0', overrides: [{ ...projectOverride, capability: 'auth.authn' }] });
    result = load(sb);
    assertPass(
      'user overrides ignored with warning',
      result.warnings.some((w) => /overrides ignored/.test(w)),
    );

    const exceptionOverride = { ...projectOverride, outcome: 'exception', intake_ref: undefined, exception_ref: 'EXC-0007' };
    writeProject(sb, { mode: 'hybrid', overrides: [exceptionOverride] });
    assertPass('unrecorded exception_ref invalid', load(sb).source === 'invalid-file');
    fs.ensureDirSync(path.join(sb.project, '.enterprise/exceptions'));
    fs.writeFileSync(path.join(sb.project, '.enterprise/exceptions/EXC-0007-legacy-idp.md'), '# exception\n');
    assertPass('exception_ref resolved by .enterprise/exceptions/<id>*.md', load(sb).source === 'project');
    fs.removeSync(path.join(sb.project, '.enterprise/exceptions/EXC-0007-legacy-idp.md'));
    fs.writeFileSync(path.join(sb.project, 'docs/decisions/2026-exception-log.md'), 'EXC-0007 approved\n');
    assertPass('exception_ref resolved in docs/decisions/*exception*.md', load(sb).source === 'project');
    assertPass(
      'exception_ref does not resolve through intake files',
      (() => {
        fs.removeSync(path.join(sb.project, 'docs/decisions/2026-exception-log.md'));
        fs.writeFileSync(path.join(sb.project, 'docs/decisions/nested/Team-INTAKE-log.md'), 'EXC-0007\n');
        return load(sb).source === 'invalid-file';
      })(),
    );

    writeProject(sb, { mode: 'hybrid', overrides: [projectOverride] });
    fs.writeFileSync(path.join(sb.project, 'docs/decisions/nested/Team-INTAKE-log.md'), 'INTAKE-1 INTAKE-2\n');
    fs.writeFileSync(path.join(sb.project, 'docs/decisions/exception-x.md'), 'EXC-9\n');
    result = load(sb, {
      flags: {
        bindings: ['cache.typed=exception:EXC-9:2026-12-31', { capability: 'auth.authn', outcome: 'keep-local', ref: 'INTAKE-2' }],
      },
    });
    assertPass(
      'flag string binding replaces same capability with default reason',
      result.overrides.length === 1 &&
        result.overrides[0].layer === 'flags' &&
        result.overrides[0].exception_ref === 'EXC-9' &&
        result.overrides[0].reason === 'declared at installation',
    );
    assertPass('flag binding without expires rejected', result.errors.length === 1 && /flag platform-binding/.test(result.errors[0]));
    result = load(sb, { flags: { bindings: ['cache.typed=exception:EXC-404:2026-12-31'] } });
    assertPass(
      'flag binding with unrecorded ref rejected, project override kept',
      result.errors.length === 1 && result.overrides[0].layer === 'project',
    );
    result = load(sb, { flags: { bindings: ['nonsense'] } });
    assertPass('malformed flag string recorded, not thrown', result.errors.length === 1 && /expected <capability>/.test(result.errors[0]));

    result = load(sb, { now: new Date('2028-01-01T00:00:00Z') });
    assertPass('expired project override invalidates the file', result.source === 'invalid-file' && result.overrides.length === 0);
    assertPass('malformed flag binding does not throw', load(sb, { flags: { bindings: [null, {}] } }).errors.length === 2);
  } finally {
    sb.cleanup();
  }
}

function testCorrectionRound() {
  console.log('\nCorrection round 1');
  const user = { layer: 'user', now: NOW };
  const base = { schema_version: '1.0.0' };
  const ov = (extra) => ({
    ...base,
    overrides: [{ capability: 'cache.typed', outcome: 'keep-local', reason: 'r', expires: '2027-01-01', intake_ref: 'INTAKE-1', ...extra }],
  });

  // 1. reference ids
  for (const id of ['the', 'INTAKE', 'INTAKE-x', '1-2026', 'A-1', 'INTAKE_2026', 'INTAKE--', 'a b-1']) {
    assertPass(
      `reference id '${id}' rejected`,
      throwsWith(() => validateBindingsDocument(ov({ intake_ref: id }), user), 'must be an identifier') === true,
    );
  }
  for (const id of ['INTAKE-2026-10-cache', 'EXC-0007', 'ab-1.x', 'INTAKE-1']) {
    assertPass(`reference id '${id}' accepted`, validateBindingsDocument(ov({ intake_ref: id }), user) !== undefined);
  }
  const sb = sandbox();
  try {
    const decisions = path.join(sb.project, 'docs', 'decisions');
    const exceptions = path.join(sb.project, '.enterprise', 'exceptions');
    fs.ensureDirSync(decisions);
    fs.ensureDirSync(exceptions);
    const withProject = { layer: 'project', now: NOW, projectDir: sb.project };
    const intakeDoc = (extra) => ({ ...base, mode: 'hybrid', ...ov(extra) });
    fs.writeFileSync(path.join(decisions, 'notes.md'), 'INTAKE-1 EXC-0007\n');
    assertPass(
      'intake token in a non-intake document does not resolve',
      throwsWith(() => validateBindingsDocument(intakeDoc({}), withProject), 'not recorded') === true,
    );
    fs.writeFileSync(path.join(decisions, 'cache-intake.md'), 'INTAKE-1\n');
    assertPass('intake token in an intake document resolves', validateBindingsDocument(intakeDoc({}), withProject) !== undefined);
    const exceptionDoc = (id) => ({ ...base, mode: 'hybrid', ...ov({ outcome: 'exception', intake_ref: undefined, exception_ref: id }) });
    assertPass(
      'exception token in a non-exception document does not resolve',
      throwsWith(() => validateBindingsDocument(exceptionDoc('EXC-0007'), withProject), 'not recorded') === true,
    );
    for (const [name, ok] of [
      ['EXC-0007-legacy.md', true],
      ['EXC-0007.md', true],
      ['EXC-00071.md', false],
      ['EXC-0007legacy.md', false],
      ['EXC-0007-legacy.txt', false],
      ['xEXC-0007.md', false],
    ]) {
      fs.emptyDirSync(exceptions);
      fs.writeFileSync(path.join(exceptions, name), '#\n');
      const result = (() => {
        try {
          validateBindingsDocument(exceptionDoc('EXC-0007'), withProject);
          return true;
        } catch {
          return false;
        }
      })();
      assertPass(`exception file name '${name}' ${ok ? 'resolves' : 'does not resolve'}`, result === ok);
    }
    fs.emptyDirSync(exceptions);
    fs.writeFileSync(path.join(decisions, 'legacy-exception-log.md'), 'EXC-0007\n');
    assertPass(
      'exception token in an exception document resolves',
      validateBindingsDocument(exceptionDoc('EXC-0007'), withProject) !== undefined,
    );

    // 2. mode_ref shape and location
    const ref = writeDecision(sb, 'docs/decisions/nested/why-local.md');
    const spec = writeDecision(sb, '.enterprise/.specs/decisions/ADR-1.md');
    const modeDoc = (mode_ref) => ({ ...base, mode: 'local', mode_ref });
    assertPass('mode_ref under docs/decisions accepted', validateBindingsDocument(modeDoc(ref), withProject) !== undefined);
    assertPass('mode_ref under .enterprise/.specs/decisions accepted', validateBindingsDocument(modeDoc(spec), withProject) !== undefined);
    for (const bad of ['README.md', 'docs/other/x.md', 'docs/decisions/x.txt', 'docs/decisions', 'src/docs/decisions/x.md']) {
      assertPass(`mode_ref '${bad}' rejected`, throwsWith(() => validateBindingsDocument(modeDoc(bad), user), 'mode_ref') === true);
    }
    assertPass(
      'missing mode_ref file rejected when projectDir known',
      throwsWith(() => validateBindingsDocument(modeDoc('docs/decisions/none.md'), withProject), 'does not exist') === true,
    );
    writeProject(sb, { mode: 'local', mode_ref: 'README.md' });
    fs.writeFileSync(path.join(sb.project, 'README.md'), '#\n');
    assertPass('existing file outside the decision directories is rejected by the loader', load(sb).source === 'invalid-file');
    const result0 = load(sb, { flags: { mode: 'local', modeRef: 'README.md' } });
    assertPass('flag modeRef outside the decision directories rejected', result0.errors.length > 0);

    // 3. user/runtime overrides stripped before validation
    writeProject(sb, { mode: 'hybrid' });
    writeYaml(userFile(sb), { schema_version: '1.0.0', mode: 'platform', overrides: [{ capability: 'bad', outcome: 'nope' }] });
    let result = load(sb);
    assertPass(
      'invalid user overrides warn but do not discard a valid stricter mode',
      result.mode === 'platform' &&
        result.source === 'user' &&
        result.errors.length === 0 &&
        result.warnings.some((w) => /user layer overrides ignored/.test(w)),
    );
    writeYaml(path.join(sb.runtime, '.enterprise/governance/capabilities/platform-bindings.defaults.yaml'), {
      schema_version: '1.0.0',
      overrides: 'garbage',
    });
    result = load(sb);
    assertPass(
      'runtime overrides ignored with warning before validation',
      result.errors.length === 0 && result.warnings.some((w) => /runtime layer overrides ignored/.test(w)),
    );
    fs.removeSync(userFile(sb));

    // 4. flags normalization
    assertPass(
      'flags: null is accepted',
      loadPlatformBindings({ projectDir: sb.project, env: sb.env, now: NOW, baseMode: 'local', flags: null }).errors.length === 0,
    );
    result = load(sb, { flags: { bindings: 'cache.typed=exception:EXC-9:2027-01-01' } });
    assertPass(
      'flags.bindings must be an array',
      result.errors.some((e) => /flags\.bindings must be a list/.test(e)),
    );
    assertPass('flags.bindings null is accepted', load(sb, { flags: { bindings: null } }).errors.length === 0);

    // 5. dot-prefixed segments
    assertPass(
      'dot-prefixed segment accepted',
      validateBindingsDocument(modeDoc('.enterprise/.specs/decisions/ADR-2.md'), user) !== undefined,
    );
    for (const bad of [
      'docs//decisions/x.md',
      'docs/./decisions/x.md',
      'docs/decisions/../x.md',
      'docs/decisions/x y.md',
      './docs/decisions/x.md',
      'docs/decisions/',
    ]) {
      assertPass(`path '${bad}' rejected`, throwsWith(() => validateBindingsDocument(modeDoc(bad), user), 'mode_ref') === true);
    }

    // 6. registry paths and source path with uri/ref
    const userDir = path.dirname(userFile(sb));
    writeYaml(userFile(sb), { schema_version: '1.0.0', registry: { source: 'path', path: 'registry/capabilities.json' } });
    assertPass(
      'relative user registry path resolves against the user file directory',
      load(sb).registry.path === path.join(userDir, 'registry', 'capabilities.json'),
    );
    const viaEnv = path.join(sb.base, 'custom', 'bindings.yaml');
    writeYaml(viaEnv, { schema_version: '1.0.0', registry: { source: 'path', path: 'r.json' } });
    assertPass(
      'HSEOS_PLATFORM_BINDINGS directory is the base for relative paths',
      load(sb, { env: { ...sb.env, HSEOS_PLATFORM_BINDINGS: viaEnv } }).registry.path === path.join(sb.base, 'custom', 'r.json'),
    );
    fs.removeSync(userFile(sb));
    fs.removeSync(path.join(sb.runtime, '.enterprise/governance/capabilities/platform-bindings.defaults.yaml'));
    writeYaml(path.join(sb.runtime, '.enterprise/governance/capabilities/platform-bindings.defaults.yaml'), {
      schema_version: '1.0.0',
      registry: { source: 'path', path: 'snap/registry.json' },
    });
    assertPass(
      'relative runtime registry path resolves against runtimeRoot',
      load(sb).registry.path === path.join(sb.runtime, 'snap', 'registry.json'),
    );
    for (const key of ['uri', 'ref']) {
      const doc = { ...base, registry: { source: 'path', path: 'r.json', [key]: 'x' } };
      assertPass(
        `source path with ${key} rejected`,
        throwsWith(() => validateBindingsDocument(doc, user), `registry.${key} is not allowed`) === true,
      );
    }
    const noMode = { ...base, mode: 'local', mode_ref: 'docs/decisions/none.md' };
    assertPass(
      'writer refuses a mode_ref that does not exist',
      throwsWith(() => writePlatformBindings(sb.project, noMode), 'does not exist') === true,
    );
    assertPass(
      'writer refuses an unrecorded intake_ref',
      throwsWith(
        () => writePlatformBindings(sb.project, { ...base, mode: 'hybrid', ...ov({ intake_ref: 'INTAKE-404' }) }, { now: NOW }),
        'not recorded',
      ) === true,
    );
    assertPass('writer accepts existing refs', writePlatformBindings(sb.project, { ...base, mode: 'local', mode_ref: ref }) !== undefined);

    // 7. size limit
    fs.writeFileSync(projectFile(sb), `schema_version: 1.0.0\nmode: platform\n# ${'x'.repeat(256 * 1024)}\n`);
    result = load(sb);
    assertPass('oversized project file rejected before parsing', result.source === 'invalid-file' && /too large/.test(result.errors[0]));
    writeYaml(userFile(sb), { schema_version: '1.0.0', mode: 'platform' });
    fs.appendFileSync(userFile(sb), `# ${'x'.repeat(256 * 1024)}\n`);
    result = load(sb);
    assertPass(
      'oversized user file rejected',
      result.errors.some((e) => e.startsWith('user layer:') && /too large/.test(e)),
    );
  } finally {
    sb.cleanup();
  }
}

function testSymlinkedReferences() {
  console.log('\nSymlinked references');
  const sb = sandbox();
  try {
    const decisions = path.join(sb.project, 'docs', 'decisions');
    fs.ensureDirSync(decisions);
    fs.writeFileSync(path.join(sb.project, 'README.md'), '# readme\nINTAKE-1\n');
    fs.symlinkSync('../../README.md', path.join(decisions, 'sym.md'));
    writeProject(sb, { mode: 'local', mode_ref: 'docs/decisions/sym.md' });
    let result = load(sb);
    assertPass(
      'mode_ref symlink escaping to README.md rejected',
      result.source === 'invalid-file' && /does not exist/.test(result.errors[0]),
    );
    result = load(sb, { flags: { mode: 'local', modeRef: 'docs/decisions/sym.md' }, baseMode: 'local' });
    assertPass('flag modeRef symlink escaping to README.md rejected', result.errors.length > 0 && result.mode === 'platform');

    fs.writeFileSync(path.join(decisions, 'real-record.md'), '# record\n');
    fs.symlinkSync('real-record.md', path.join(decisions, 'alias.md'));
    writeProject(sb, { mode: 'local', mode_ref: 'docs/decisions/alias.md' });
    result = load(sb);
    assertPass(
      'symlink to another decision record inside the root accepted',
      result.source === 'project' && result.mode === 'local' && result.errors.length === 0,
    );

    fs.mkdirSync(path.join(sb.project, 'docs', 'other'));
    fs.writeFileSync(path.join(sb.project, 'docs', 'other', 'note.md'), '#\n');
    fs.symlinkSync('../other/note.md', path.join(decisions, 'sideways.md'));
    writeProject(sb, { mode: 'local', mode_ref: 'docs/decisions/sideways.md' });
    assertPass('symlink to a non-decision file inside the project rejected', load(sb).source === 'invalid-file');

    const outsideIntake = path.join(sb.base, 'outside-intake.md');
    fs.writeFileSync(outsideIntake, 'INTAKE-7\n');
    fs.symlinkSync(outsideIntake, path.join(decisions, 'linked-intake.md'));
    const override = { capability: 'cache.typed', outcome: 'keep-local', intake_ref: 'INTAKE-7', reason: 'r', expires: '2027-01-01' };
    writeProject(sb, { mode: 'hybrid', overrides: [override] });
    assertPass('intake file symlinked from outside the root is ignored', load(sb).source === 'invalid-file');
    fs.symlinkSync(path.join(decisions, 'real-record.md'), path.join(decisions, 'linked-in-intake.md'));
    fs.writeFileSync(path.join(decisions, 'real-intake.md'), 'INTAKE-7\n');
    assertPass('regular intake file still resolves alongside ignored symlinks', load(sb).source === 'project');

    const exceptionsTarget = path.join(sb.base, 'EXC-0099.md');
    fs.writeFileSync(exceptionsTarget, '#\n');
    fs.ensureDirSync(path.join(sb.project, '.enterprise', 'exceptions'));
    fs.symlinkSync(exceptionsTarget, path.join(sb.project, '.enterprise', 'exceptions', 'EXC-0099.md'));
    const exception = { capability: 'cache.typed', outcome: 'exception', exception_ref: 'EXC-0099', reason: 'r', expires: '2027-01-01' };
    writeProject(sb, { mode: 'hybrid', overrides: [exception] });
    assertPass('exception file symlinked from outside is ignored', load(sb).source === 'invalid-file');

    fs.removeSync(path.join(sb.project, '.enterprise', 'exceptions'));
    const outsideDir = path.join(sb.base, 'outside-exceptions');
    fs.ensureDirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'EXC-0099.md'), '#\n');
    fs.symlinkSync(outsideDir, path.join(sb.project, '.enterprise', 'exceptions'));
    assertPass('symlinked exceptions directory is ignored', load(sb).source === 'invalid-file');

    fs.removeSync(decisions);
    const outsideDecisions = path.join(sb.base, 'outside-decisions');
    fs.ensureDirSync(outsideDecisions);
    fs.writeFileSync(path.join(outsideDecisions, 'a-intake.md'), 'INTAKE-7\n');
    fs.symlinkSync(outsideDecisions, decisions);
    writeProject(sb, { mode: 'hybrid', overrides: [override] });
    assertPass('symlinked docs/decisions directory is ignored for intake', load(sb).source === 'invalid-file');
  } finally {
    sb.cleanup();
  }
}

function testParseFlag() {
  console.log('\nparsePlatformBindingFlag');
  const parsed = parsePlatformBindingFlag('cache.typed=keep-local:INTAKE-1:2027-03-31');
  assertPass(
    'parses capability, outcome, ref, expires and default reason',
    parsed.capability === 'cache.typed' &&
      parsed.outcome === 'keep-local' &&
      parsed.ref === 'INTAKE-1' &&
      parsed.expires === '2027-03-31' &&
      parsed.reason === 'declared at installation',
  );
  for (const bad of ['', 'cache.typed', 'cache.typed=keep-local', 'cache.typed=keep-local:INTAKE-1', 'a=b:c:d:e', '=x:y:z', undefined, 7]) {
    assertPass(`malformed '${bad}' rejected`, throwsWith(() => parsePlatformBindingFlag(bad), 'Invalid --platform-binding') === true);
  }
}

function testRegistryResolution() {
  console.log('\nRegistry resolution');
  const sb = sandbox();
  try {
    const defaults = path.join(sb.runtime, '.enterprise/governance/capabilities/platform-bindings.defaults.yaml');
    assertPass('nothing configured -> snapshot', load(sb).registry.source === 'snapshot' && Object.keys(load(sb).registry).length === 1);
    writeYaml(userFile(sb), { schema_version: '1.0.0', workspace: { ecp_root: '/ecp' } });
    let registry = load(sb).registry;
    assertPass(
      'user ecp_root shorthand',
      registry.source === 'path' && registry.path === path.join('/ecp', 'catalog', 'capability-registry.json'),
    );
    assertPass('user workspace exposed', load(sb).workspace.ecp_root === '/ecp');

    writeYaml(defaults, { schema_version: '1.0.0', registry: { source: 'snapshot' } });
    registry = load(sb).registry;
    assertPass('runtime registry block beats ecp_root shorthand', registry.source === 'snapshot');

    writeYaml(userFile(sb), {
      schema_version: '1.0.0',
      workspace: { ecp_root: '/ecp' },
      registry: { source: 'path', path: '/explicit/registry.json' },
    });
    registry = load(sb).registry;
    assertPass('user registry block beats runtime and ecp_root', registry.path === '/explicit/registry.json');

    writeProject(sb, { mode: 'platform', registry: { source: 'path', path: 'vendor/registry.json' } });
    registry = load(sb).registry;
    assertPass(
      'project registry beats user; relative path resolved to project',
      registry.path === path.join(sb.project, 'vendor', 'registry.json'),
    );
    writeProject(sb, { mode: 'platform', registry: { source: 'path', path: '/abs/registry.json' } });
    assertPass(
      'absolute project registry path invalid',
      load(sb).source === 'invalid-file' && /registry\.path .* in the project file/.test(load(sb).errors[0]),
    );
    writeProject(sb, { mode: 'platform', registry: { source: 'path', path: '../registry.json' } });
    assertPass('dotdot project registry path invalid', load(sb).source === 'invalid-file');
    writeYaml(userFile(sb), { schema_version: '1.0.0', registry: { source: 'path', path: '/abs/registry.json' } });
    fs.removeSync(projectFile(sb));
    assertPass('absolute registry path stays valid in the user layer', load(sb).registry.path === '/abs/registry.json');
    writeProject(sb, { mode: 'platform', registry: { source: 'remote', uri: 'https://x', ref: 'v1', sha256: 'a'.repeat(64) } });
    assertPass('remote registry returned as declared', load(sb).registry.source === 'remote' && load(sb).registry.ref === 'v1');
  } finally {
    sb.cleanup();
  }
}

function touch(root, rel) {
  fs.ensureDirSync(path.dirname(path.join(root, rel)));
  fs.writeFileSync(path.join(root, rel), '');
}

function testStacks() {
  console.log('\nStacks');
  const sb = sandbox();
  try {
    assertPass('empty project has no stacks', detectStacks(sb.project).length === 0);
    assertPass('missing project dir has no stacks', detectStacks(path.join(sb.base, 'absent')).length === 0);
    touch(sb.project, 'App.csproj');
    touch(sb.project, 'package.json');
    assertPass('root markers detected and sorted', detectStacks(sb.project).join(',') === 'dotnet,node');
    touch(sb.project, 'apps/api/pyproject.toml');
    touch(sb.project, 'services/billing/go.mod');
    touch(sb.project, 'src/core/pom.xml');
    assertPass('one level of apps/services/src detected', detectStacks(sb.project).join(',') === 'dotnet,go,java,node,python');
    touch(sb.project, 'apps/web/deep/nested/setup.py');
    touch(sb.project, 'node_modules/x/build.gradle.kts');
    assertPass('deeper and unrelated directories ignored', detectStacks(sb.project).join(',') === 'dotnet,go,java,node,python');
    const other = path.join(sb.base, 'other');
    touch(other, 'build.gradle.kts');
    touch(other, 'solution.slnx');
    touch(other, 'src/main.sln');
    touch(other, 'setup.py');
    assertPass('gradle, slnx, sln and setup.py markers', detectStacks(other).join(',') === 'dotnet,java,python');
    fs.symlinkSync(path.join(sb.project, 'go.mod'), path.join(other, 'go.mod'));
    touch(sb.project, 'go.mod');
    assertPass('symlinked markers ignored', !detectStacks(other).includes('go'));

    const explicit = path.join(sb.base, 'explicit');
    touch(explicit, 'package.json');
    fs.ensureDirSync(explicit);
    writeYaml(path.join(explicit, '.hseos/config/platform-bindings.yaml'), {
      schema_version: '1.0.0',
      mode: 'platform',
      stacks: ['dotnet', 'react'],
    });
    const result = loadPlatformBindings({ projectDir: explicit, env: sb.env, now: NOW });
    assertPass('explicit stacks replace detection', result.stacks.join(',') === 'dotnet,react');
    writeYaml(path.join(explicit, '.hseos/config/platform-bindings.yaml'), { schema_version: '1.0.0', mode: 'platform' });
    assertPass(
      'detection used when stacks absent',
      loadPlatformBindings({ projectDir: explicit, env: sb.env, now: NOW }).stacks.join(',') === 'node',
    );
  } finally {
    sb.cleanup();
  }
}

function testWriter() {
  console.log('\nwritePlatformBindings');
  const sb = sandbox();
  try {
    const doc = { schema_version: '1.0.0', mode: 'hybrid', stacks: ['node'] };
    const target = writePlatformBindings(sb.project, doc, { now: NOW });
    assertPass('writes the project file', target === projectFile(sb) && yaml.parse(fs.readFileSync(target, 'utf8')).mode === 'hybrid');
    assertPass('writer output round-trips through loader', load(sb).mode === 'hybrid');
    assertPass(
      'no staging files left',
      fs.readdirSync(path.dirname(target)).every((name) => !name.endsWith('.tmp')),
    );

    writePlatformBindings(sb.project, { ...doc, mode: 'platform' });
    assertPass('overwrites atomically', yaml.parse(fs.readFileSync(target, 'utf8')).mode === 'platform');

    assertPass(
      'invalid document refused',
      throwsWith(() => writePlatformBindings(sb.project, { schema_version: '1.0.0' }), 'must declare mode') === true,
    );
    assertPass(
      'workspace refused',
      throwsWith(() => writePlatformBindings(sb.project, { ...doc, workspace: { ecp_root: '/x' } }), 'workspace') === true,
    );
    assertPass('previous content kept after refusal', yaml.parse(fs.readFileSync(target, 'utf8')).mode === 'platform');

    const outside = path.join(sb.base, 'outside.yaml');
    fs.writeFileSync(outside, 'keep: true\n');
    fs.removeSync(target);
    fs.symlinkSync(outside, target);
    assertPass('symlinked target refused', throwsWith(() => writePlatformBindings(sb.project, doc), 'symlink') === true);
    assertPass('symlink destination untouched', fs.readFileSync(outside, 'utf8') === 'keep: true\n');
    fs.removeSync(target);

    const linked = path.join(sb.base, 'linked');
    const realConfig = path.join(sb.base, 'real-hseos');
    fs.ensureDirSync(linked);
    fs.ensureDirSync(realConfig);
    fs.symlinkSync(realConfig, path.join(linked, '.hseos'));
    assertPass('symlinked .hseos refused', throwsWith(() => writePlatformBindings(linked, doc), 'symlink') === true);
    assertPass('nothing written through symlinked directory', fs.readdirSync(realConfig).length === 0);

    const linkedConfig = path.join(sb.base, 'linked-config');
    fs.ensureDirSync(path.join(linkedConfig, '.hseos'));
    fs.ensureDirSync(path.join(sb.base, 'real-config'));
    fs.symlinkSync(path.join(sb.base, 'real-config'), path.join(linkedConfig, '.hseos', 'config'));
    assertPass('symlinked config dir refused', throwsWith(() => writePlatformBindings(linkedConfig, doc), 'symlink') === true);

    const blocked = path.join(sb.base, 'blocked');
    fs.ensureDirSync(path.join(blocked, '.hseos', 'config', 'platform-bindings.yaml'));
    let failedWrite = false;
    try {
      writePlatformBindings(blocked, doc);
    } catch {
      failedWrite = true;
    }
    assertPass(
      'rename failure propagates and leaves no staging file',
      failedWrite && fs.readdirSync(path.join(blocked, '.hseos', 'config')).join(',') === 'platform-bindings.yaml',
    );
  } finally {
    sb.cleanup();
  }
}

function run() {
  testModes();
  testVectors();
  testLayerRules();
  testNoFileAndInvalidFile();
  testWeakeningRules();
  testOverrides();
  testParseFlag();
  testCorrectionRound();
  testSymlinkedReferences();
  testRegistryResolution();
  testStacks();
  testWriter();

  console.log(`\nPlatform bindings tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
