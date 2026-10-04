/**
 * Capability registry tests (ADR-0046 §7)
 *
 * Covers snapshot integrity, the path and remote sources, structural validation,
 * deterministic resolution and export matching against ECP registry data.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const fs = require('fs-extra');
const {
  RegistryIntegrityError,
  SNAPSHOT_FILE,
  SNAPSHOT_LOCK_FILE,
  loadCapabilityRegistry,
  matchExport,
  resolveCapability,
  validateCapabilityRegistry,
} = require('../tools/cli/lib/capability-registry');

const REPO_ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'ecp-registry', 'registry-0.3.0.json');

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

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

function tempDir() {
  return fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hseos-registry-'));
}

function copyRuntime(target) {
  for (const file of [SNAPSHOT_FILE, SNAPSHOT_LOCK_FILE]) {
    fs.ensureDirSync(path.dirname(path.join(target, file)));
    fs.copyFileSync(path.join(REPO_ROOT, file), path.join(target, file));
  }
}

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const exportMatches = (registry, options) => matchExport(registry, options).matches;
const first = (registry, query, options) => resolveCapability(registry, query, options)[0];

function testSnapshot() {
  console.log('\nSnapshot');
  const loaded = loadCapabilityRegistry({ runtimeRoot: REPO_ROOT });
  const lock = fs.readJsonSync(path.join(REPO_ROOT, SNAPSHOT_LOCK_FILE));
  assertPass('default (no bindings) loads the shipped snapshot', loaded.source === 'snapshot');
  assertPass(
    'sha256 matches the file bytes and the lock',
    loaded.sha256 === sha(fs.readFileSync(path.join(REPO_ROOT, SNAPSHOT_FILE))) && loaded.sha256 === lock.sha256,
  );
  assertPass(
    'ref and contracts version come from the lock',
    loaded.ref === 'contracts-v0.3.1' && loaded.registry.generated_from.contracts_version === '0.3.1',
  );
  assertPass(
    'shipped snapshot is byte-identical to the 0.3.1 fixture',
    fs
      .readFileSync(path.join(REPO_ROOT, SNAPSHOT_FILE))
      .equals(fs.readFileSync(path.join(__dirname, 'fixtures', 'ecp-registry', 'registry-0.3.1.json'))),
  );
  assertPass(
    'shipped snapshot resolves Redis -> cache.typed and auth -> security.authn',
    first(loaded.registry, 'Redis').capability.name === 'cache.typed' &&
      first(loaded.registry, 'auth').capability.name === 'security.authn',
  );
  assertPass(
    'explicit snapshot binding loads',
    loadCapabilityRegistry({ runtimeRoot: REPO_ROOT, bindings: { registry: { source: 'snapshot' } } }).registry.capabilities.length > 0,
  );
  assertPass(
    'pinned sha256 that matches is accepted',
    loadCapabilityRegistry({ runtimeRoot: REPO_ROOT, bindings: { registry: { source: 'snapshot', sha256: lock.sha256 } } }).sha256 ===
      lock.sha256,
  );
  const pinned = thrown(() =>
    loadCapabilityRegistry({ runtimeRoot: REPO_ROOT, bindings: { registry: { source: 'snapshot', sha256: 'a'.repeat(64) } } }),
  );
  assertPass('pinned sha256 mismatch -> RegistryIntegrityError', pinned instanceof RegistryIntegrityError);
  assertPass('snapshot requires runtimeRoot', /runtimeRoot/.test(String(thrown(() => loadCapabilityRegistry({})))));

  const root = tempDir();
  try {
    copyRuntime(root);
    fs.appendFileSync(path.join(root, SNAPSHOT_FILE), ' ');
    const tampered = thrown(() => loadCapabilityRegistry({ runtimeRoot: root }));
    assertPass(
      'tampered snapshot -> RegistryIntegrityError',
      tampered instanceof RegistryIntegrityError && /sha256 mismatch/.test(tampered.message) && tampered.name === 'RegistryIntegrityError',
    );

    copyRuntime(root);
    fs.removeSync(path.join(root, SNAPSHOT_LOCK_FILE));
    assertPass(
      'missing lock -> RegistryIntegrityError',
      thrown(() => loadCapabilityRegistry({ runtimeRoot: root })) instanceof RegistryIntegrityError,
    );
    fs.writeFileSync(path.join(root, SNAPSHOT_LOCK_FILE), '{"schema_version":"1.0.0"}');
    assertPass(
      'incomplete lock -> RegistryIntegrityError',
      thrown(() => loadCapabilityRegistry({ runtimeRoot: root })) instanceof RegistryIntegrityError,
    );
    fs.writeFileSync(path.join(root, SNAPSHOT_LOCK_FILE), '[]');
    assertPass(
      'malformed lock -> RegistryIntegrityError',
      thrown(() => loadCapabilityRegistry({ runtimeRoot: root })) instanceof RegistryIntegrityError,
    );

    copyRuntime(root);
    fs.writeJsonSync(path.join(root, SNAPSHOT_LOCK_FILE), { ...lock, contracts_version: '9.9.9' });
    const mismatch = thrown(() => loadCapabilityRegistry({ runtimeRoot: root }));
    assertPass(
      'lock contracts_version mismatch -> RegistryIntegrityError',
      mismatch instanceof RegistryIntegrityError && /contracts_version/.test(mismatch.message),
    );

    copyRuntime(root);
    const broken = Buffer.from('{"schema_version":"1"}');
    fs.writeFileSync(path.join(root, SNAPSHOT_FILE), broken);
    fs.writeJsonSync(path.join(root, SNAPSHOT_LOCK_FILE), { ...lock, sha256: sha(broken) });
    assertPass(
      'hash-valid but structurally invalid snapshot is rejected',
      /Invalid capability registry/.test(String(thrown(() => loadCapabilityRegistry({ runtimeRoot: root })))),
    );
  } finally {
    fs.removeSync(root);
  }
}

function testPathAndRemote() {
  console.log('\nPath and remote sources');
  const loaded = loadCapabilityRegistry({ bindings: { registry: { source: 'path', path: FIXTURE } } });
  assertPass(
    'path source loads and hashes the file',
    loaded.source === 'path' && loaded.sha256 === sha(fs.readFileSync(FIXTURE)) && loaded.ref === null,
  );
  assertPass('fixture is the 0.3.0 registry', loaded.registry.generated_from.contracts_version === '0.3.0');
  assertPass(
    'path source honors a pinned sha256',
    thrown(() => loadCapabilityRegistry({ bindings: { registry: { source: 'path', path: FIXTURE, sha256: 'b'.repeat(64) } } })) instanceof
      RegistryIntegrityError,
  );
  assertPass(
    'path source requires a path',
    /registry\.path/.test(String(thrown(() => loadCapabilityRegistry({ bindings: { registry: { source: 'path' } } })))),
  );
  assertPass(
    'missing file is an error',
    thrown(() => loadCapabilityRegistry({ bindings: { registry: { source: 'path', path: '/nonexistent/registry.json' } } })) !== null,
  );
  const remote = thrown(() =>
    loadCapabilityRegistry({ bindings: { registry: { source: 'remote', uri: 'https://x', ref: 'v1', sha256: 'a'.repeat(64) } } }),
  );
  assertPass('remote source -> clear sync message', remote && /hseos platform-bindings sync/.test(remote.message));
  assertPass(
    'unknown source rejected',
    /Unknown registry source/.test(
      String(thrown(() => loadCapabilityRegistry({ runtimeRoot: REPO_ROOT, bindings: { registry: { source: 'git' } } }))),
    ),
  );

  const dir = tempDir();
  try {
    const write = (name, content) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, content);
      return { registry: { source: 'path', path: file } };
    };
    assertPass(
      'invalid JSON rejected',
      /not valid JSON/.test(String(thrown(() => loadCapabilityRegistry({ bindings: write('a.json', '{nope') })))),
    );
    assertPass(
      'directory rejected',
      /not a regular file/.test(String(thrown(() => loadCapabilityRegistry({ bindings: { registry: { source: 'path', path: dir } } })))),
    );
    const big = write('big.json', Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));
    assertPass(
      'registry over 5 MiB rejected before parsing',
      /too large/.test(String(thrown(() => loadCapabilityRegistry({ bindings: big })))),
    );
  } finally {
    fs.removeSync(dir);
  }
}

function testValidation() {
  console.log('\nValidation');
  assertPass('fixture validates', validateCapabilityRegistry(fixture()) !== undefined);
  const mutate = (fn) => {
    const registry = fixture();
    fn(registry);
    return String(thrown(() => validateCapabilityRegistry(registry)));
  };
  const cache = (registry) => registry.capabilities.find((capability) => capability.name === 'cache.typed');
  const cases = [
    ['non-object root', () => String(thrown(() => validateCapabilityRegistry([]))), 'must be an object'],
    ['unknown root field', (r) => (r.extra = 1), "unknown field 'extra'"],
    ['wrong schema_version', (r) => (r.schema_version = '2'), "schema_version must be '1'"],
    ['missing generated_from', (r) => delete r.generated_from, 'generated_from'],
    ['bad contracts_version', (r) => (r.generated_from.contracts_version = 'x'), 'contracts_version'],
    ['capabilities not a list', (r) => (r.capabilities = {}), 'capabilities must be a list'],
    ['duplicate capability', (r) => r.capabilities.push(structuredClone(r.capabilities[0])), 'duplicated'],
    ['bad name', (r) => (cache(r).name = 'Cache'), 'dotted capability name'],
    ['bad kind', (r) => (cache(r).kind = 'tool'), 'kind'],
    ['bad stability', (r) => (cache(r).stability = 'gold'), 'stability'],
    ['deprecated without deprecation', (r) => (cache(r).stability = 'deprecated'), 'deprecation is required'],
    ['bad alias list', (r) => (cache(r).aliases = [1]), 'aliases'],
    ['bad match key', (r) => (cache(r).match.other = []), "unknown field 'other'"],
    ['bad match symbols', (r) => (cache(r).match.symbols = 'x'), 'match.symbols'],
    ['empty files', (r) => (cache(r).files = []), 'files must be a non-empty list'],
    ['bad file sha', (r) => (cache(r).files[0].sha256 = 'zz'), 'sha256'],
    ['bad file role', (r) => (cache(r).files[0].role = 'other'), 'role'],
    ['implementations not a list', (r) => (cache(r).implementations = {}), 'implementations must be a list'],
    ['implementation missing stack', (r) => delete cache(r).implementations[0].stack, 'stack is required'],
    ['implementation bad status', (r) => (cache(r).implementations[0].status = 'ready'), 'status'],
    ['implementation unknown field', (r) => (cache(r).implementations[0].x = 1), "unknown field 'x'"],
    ['stable without conformance', (r) => (cache(r).implementations[0].status = 'stable'), 'conformance is required'],
    ['bad package_version', (r) => (cache(r).implementations[0].package_version = 'v1'), 'package_version'],
    ['bad conformance', (r) => (cache(r).implementations[0].conformance = {}), 'vectors_version'],
    ['bad related_capabilities', (r) => (cache(r).related_capabilities = ['X']), 'related_capabilities'],
    ['bad deprecation', (r) => (cache(r).deprecation = { since: '1', sunset: 'soon', replaced_by: 'x' }), 'deprecation'],
  ];
  for (const [label, mutation, fragment] of cases) {
    const message = mutation.length === 0 ? mutation() : mutate(mutation);
    assertPass(`rejects ${label}`, message.includes(fragment), message);
  }
  const registry = fixture();
  const stable = cache(registry).implementations[0];
  stable.status = 'stable';
  stable.package_version = '1.0.0';
  stable.conformance = { vectors_version: '0.1.0', evidence: 'ci' };
  assertPass('stable implementation with evidence is accepted', validateCapabilityRegistry(registry) !== undefined);
  const deprecated = fixture();
  Object.assign(cache(deprecated), {
    stability: 'deprecated',
    deprecation: { since: '0.2.0', sunset: '2027-01-01', replaced_by: 'cache.v2@1.0.0' },
  });
  assertPass('deprecated capability with deprecation is accepted', validateCapabilityRegistry(deprecated) !== undefined);
  const many = fixture();
  for (const capability of many.capabilities) capability.name = 'Bad';
  assertPass('long problem lists are truncated', /and \d+ more/.test(String(thrown(() => validateCapabilityRegistry(many)))));
}

function testResolution() {
  console.log('\nResolution');
  const { registry } = loadCapabilityRegistry({ bindings: { registry: { source: 'path', path: FIXTURE } } });
  const expectations = [
    ['cache', 'cache.typed', 'alias'],
    ['CACHE', 'cache.typed', 'alias'],
    ['Hideakisolutions.Platform.Caching.Redis', 'cache.typed', 'package'],
    ['hideakisolutions.platform.caching.redis', 'cache.typed', 'package'],
    ['ICacheStore', 'cache.typed', 'symbol'],
    ['ICache', 'cache.typed', 'prefix'],
    ['Redis', 'cache.typed', 'heuristic'],
    ['auth', 'security.authn', 'alias'],
    ['platform-core/auth/auth-provider', 'security.authn', 'contract'],
    ['backend-core/security/auth-middleware', 'security.authn', 'contract'],
    ['AddPlatformJwtBearer', 'security.authn', 'symbol'],
    ['Authn', 'security.authn', 'heuristic'],
    ['JwtBearer', 'security.authn', 'heuristic'],
    ['platform-core/messaging/event-envelope', 'messaging.event-envelope', 'contract'],
    ['event-envelope', 'messaging.event-envelope', 'heuristic'],
    ['EventEnvelope', 'messaging.event-envelope', 'symbol'],
    ['sub/dir/event-envelope.schema.json', 'messaging.event-envelope', 'path'],
    ['security.authn', 'security.authn', 'name'],
    ['AUTH.AUTHENTICATE', 'auth.authenticate', 'name'],
    ['security', 'security.authn', 'prefix'],
  ];
  for (const [query, name, matchedBy] of expectations) {
    const result = first(registry, query);
    assertPass(
      `'${query}' -> ${name} (${matchedBy})`,
      result && result.capability.name === name && result.matchedBy === matchedBy,
      result ? `${result.capability.name} ${result.matchedBy}` : 'no match',
    );
  }
  const auth = resolveCapability(registry, 'auth');
  assertPass(
    'auth also lists auth.authenticate by prefix, after the alias hit',
    auth.length === 2 && auth[1].capability.name === 'auth.authenticate' && auth[1].matchedBy === 'prefix' && auth[0].score > auth[1].score,
  );
  assertPass(
    'name outranks alias for the same query',
    (() => {
      const clone = fixture();
      clone.capabilities.find((c) => c.name === 'cache.typed').aliases.push('data.query');
      const results = resolveCapability(clone, 'data.query');
      return results[0].matchedBy === 'name' && results[1].matchedBy === 'alias';
    })(),
  );
  assertPass('unknown query -> []', resolveCapability(registry, 'zzz-no-such-thing').length === 0);
  assertPass(
    'empty and non-string queries -> []',
    resolveCapability(registry, '').length === 0 && resolveCapability(registry).length === 0,
  );
  assertPass(
    'heuristic only when nothing else matches',
    resolveCapability(registry, 'auth').every((result) => result.matchedBy !== 'heuristic'),
  );
  assertPass(
    'ties break by capability name',
    (() => {
      const names = resolveCapability(registry, 'ecp_runtime').map((result) => result.capability.name);
      return names.length > 1 && names.join('|') === [...names].sort().join('|');
    })(),
  );
  assertPass(
    'shared runtime package resolves every service by package',
    resolveCapability(registry, 'ecp_runtime').every((result) => result.matchedBy === 'package'),
  );
  assertPass(
    'two calls are deeply equal',
    JSON.stringify(resolveCapability(registry, 'auth')) === JSON.stringify(resolveCapability(registry, 'auth')),
  );

  const all = first(registry, 'Hideakisolutions.Platform.Caching.Redis');
  assertPass('without stacks every implementation is kept', all.implementations.length === 2);
  const dotnet = first(registry, 'cache', { stacks: ['dotnet'] });
  assertPass(
    'stacks filter keeps matching implementations',
    dotnet.implementations.length === 2 && dotnet.implementations.every((i) => i.stack === 'dotnet'),
  );
  const node = first(registry, 'auth', { stacks: ['node'] });
  assertPass(
    'stacks filter selects the node package',
    node.implementations.length === 1 && node.implementations[0].package === '@hideakisolutions/platform-node',
  );
  const none = first(registry, 'cache', { stacks: ['go'] });
  assertPass(
    'capability is kept with no implementation for the stack',
    none.capability.name === 'cache.typed' && none.implementations.length === 0,
  );
  assertPass('empty stacks list keeps everything', first(registry, 'cache', { stacks: [] }).implementations.length === 2);
  assertPass(
    'snapshot resolves services by name',
    first(loadCapabilityRegistry({ runtimeRoot: REPO_ROOT }).registry, 'auth.authenticate').matchedBy === 'name',
  );
}

function testMatchExport() {
  console.log('\nmatchExport');
  const { registry } = loadCapabilityRegistry({ bindings: { registry: { source: 'path', path: FIXTURE } } });
  const symbol = exportMatches(registry, { symbol: 'ICacheStore', stacks: ['dotnet'] });
  assertPass(
    'exact symbol matches',
    symbol.length === 1 && symbol[0].capability.name === 'cache.typed' && symbol[0].matchedBy === 'symbol',
  );
  assertPass('experimental implementations are not stable', symbol[0].stableForStack === false);
  assertPass(
    'symbol match is exact and case-sensitive',
    exportMatches(registry, { symbol: 'icachestore' }).length === 0 && exportMatches(registry, { symbol: 'ICache' }).length === 0,
  );
  const glob = exportMatches(registry, { filePath: 'schemas/event-envelope.schema.json' });
  assertPass(
    'path glob ** matches nested path',
    glob.length === 1 && glob[0].capability.name === 'messaging.event-envelope' && glob[0].matchedBy === 'path',
  );
  assertPass('path glob ** matches the repository root', exportMatches(registry, { filePath: 'event-envelope.schema.json' }).length === 1);
  assertPass(
    'glob normalizes ./ and backslashes',
    exportMatches(registry, { filePath: String.raw`.\a\auth-provider.schema.json` }).length === 1 &&
      exportMatches(registry, { filePath: './auth-provider.schema.json' }).length === 1,
  );
  assertPass('unrelated path does not match', exportMatches(registry, { filePath: 'src/other.json' }).length === 0);
  assertPass('nothing given -> []', exportMatches(registry).length === 0 && exportMatches(registry, {}).length === 0);
  assertPass(
    'two matchers on one call sort by name',
    exportMatches(registry, { symbol: 'EventEnvelope', filePath: 'x/auth-provider.schema.json' })
      .map((r) => r.capability.name)
      .join(',') === 'messaging.event-envelope,security.authn',
  );

  const stable = fixture();
  const cache = stable.capabilities.find((capability) => capability.name === 'cache.typed');
  cache.implementations[0].status = 'stable';
  cache.implementations[0].package_version = '1.0.0';
  cache.implementations[0].conformance = { vectors_version: '0.1.0' };
  assertPass(
    'stable in the project stack -> stableForStack',
    exportMatches(stable, { symbol: 'CacheKey', stacks: ['dotnet'] })[0].stableForStack === true,
  );
  assertPass(
    'stable only in another stack -> false',
    exportMatches(stable, { symbol: 'CacheKey', stacks: ['node'] })[0].stableForStack === false,
  );
  assertPass('omitted stacks consider every stack', exportMatches(stable, { symbol: 'CacheKey' })[0].stableForStack === true);
  assertPass('empty stacks mean unknown = any stack', exportMatches(stable, { symbol: 'CacheKey', stacks: [] })[0].stableForStack === true);
  assertPass(
    'match implementations follow the stack filter',
    exportMatches(stable, { symbol: 'CacheKey', stacks: ['node'] })[0].implementations.length === 0,
  );
  assertPass(
    'matchExport is deterministic',
    JSON.stringify(exportMatches(registry, { symbol: 'EventEnvelope' })) ===
      JSON.stringify(exportMatches(registry, { symbol: 'EventEnvelope' })),
  );

  const globs = fixture();
  const target = globs.capabilities.find((capability) => capability.name === 'cache.typed');
  target.match.path_globs = ['src/*/cache?.ts', 'lib/**', 'a.b+c/**/z.ts'];
  const hit = (filePath) => exportMatches(globs, { filePath }).length === 1;
  assertPass('* stays within a segment', hit('src/x/cacheA.ts') && !hit('src/x/y/cacheA.ts'));
  assertPass('? matches exactly one character', hit('src/x/cacheB.ts') && !hit('src/x/cache.ts') && !hit('src/x/cacheBB.ts'));
  assertPass('trailing ** matches anything below', hit('lib/a/b/c.ts') && hit('lib/x'));
  assertPass('regex metacharacters are literal', hit('a.b+c/z.ts') && hit('a.b+c/m/n/z.ts') && !hit('aXb+c/z.ts'));
}

function testCorrectionRound() {
  console.log('\nCorrection round 1');
  const { registry } = loadCapabilityRegistry({ bindings: { registry: { source: 'path', path: FIXTURE } } });
  const withGlobs = (globs) => {
    const clone = fixture();
    clone.capabilities.find((capability) => capability.name === 'cache.typed').match.path_globs = globs;
    return clone;
  };
  const authGlobs = withGlobs(['src/auth/**']);
  const hit = (registryData, filePath) => exportMatches(registryData, { filePath }).length === 1;

  // 1. path normalization
  for (const good of [
    'src//auth/x.ts',
    'src/./auth/x.ts',
    'src/other/../auth/x.ts',
    './src/auth/x.ts',
    String.raw`src\auth\x.ts`,
    'src/auth/',
  ]) {
    assertPass(`'${good}' matches src/auth/**`, hit(authGlobs, good));
  }
  for (const bad of [
    'src/auth/../other/x.ts',
    '/src/auth/x.ts',
    '../src/auth/x.ts',
    'src/../../src/auth/x.ts',
    'C:/src/auth/x.ts',
    '..',
    '.',
    '',
  ]) {
    assertPass(`'${bad}' does not match src/auth/**`, !hit(authGlobs, bad));
  }
  assertPass(
    'an escaping path does not stop symbol matching',
    exportMatches(registry, { symbol: 'ICacheStore', filePath: '../../etc/passwd' })[0].matchedBy === 'symbol',
  );

  // 2. stack semantics
  const stable = fixture();
  const cache = stable.capabilities.find((capability) => capability.name === 'cache.typed');
  cache.implementations[0].status = 'stable';
  cache.implementations[0].package_version = '1.0.0';
  cache.implementations[0].conformance = { vectors_version: '0.1.0' };
  const stack = (stacks) => exportMatches(stable, { symbol: 'CacheKey', stacks })[0];
  for (const unknown of [undefined, [], null]) {
    const result = stack(unknown);
    assertPass(
      `stacks ${JSON.stringify(unknown)} = any stack: stable and unfiltered`,
      result.stableForStack === true && result.implementations.length === 2,
    );
    assertPass(
      `resolveCapability stacks ${JSON.stringify(unknown)} does not filter`,
      resolveCapability(stable, 'cache', { stacks: unknown })[0].implementations.length === 2,
    );
  }
  assertPass(
    'uppercase stack names compare case-insensitively',
    stack(['DOTNET']).stableForStack === true && stack(['DOTNET']).implementations.length === 2,
  );
  assertPass(
    'resolveCapability is case-insensitive on stacks too',
    resolveCapability(stable, 'cache', { stacks: ['DotNet'] })[0].implementations.length === 2,
  );
  assertPass(
    'a non-matching non-empty list filters everything',
    stack(['node']).stableForStack === false && stack(['node']).implementations.length === 0,
  );

  // 3. glob safety
  const pathological = Array.from({ length: 30 }, () => '**').join('/a/') + '/b';
  const longPath = `${Array.from({ length: 40 }, () => 'a').join('/')}/c`;
  const started = process.hrtime.bigint();
  const slowHit = exportMatches(withGlobs([pathological, '**/**/**/x', '*'.repeat(100) + 'z']), { filePath: longPath }).length;
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assertPass('pathological globs finish quickly with no match', slowHit === 0 && elapsedMs < 50, `${elapsedMs.toFixed(1)} ms`);
  const tooLong = withGlobs(['a'.repeat(513)]);
  const longResult = matchExport(tooLong, { filePath: 'a'.repeat(513) });
  assertPass(
    'glob over 512 characters never matches and warns',
    longResult.matches.length === 0 && longResult.warnings.length === 1 && /ignored/.test(longResult.warnings[0]),
  );
  const manySegments = withGlobs([Array.from({ length: 65 }, () => 'a').join('/')]);
  assertPass(
    'glob over 64 segments never matches and warns',
    matchExport(manySegments, { filePath: Array.from({ length: 65 }, () => 'a').join('/') }).warnings.length === 1,
  );
  assertPass(
    'glob at the caps still works',
    hit(withGlobs([Array.from({ length: 64 }, () => 'a').join('/')]), Array.from({ length: 64 }, () => 'a').join('/')),
  );
  assertPass(
    'consecutive ** collapse',
    hit(withGlobs(['**/**/x.ts']), 'x.ts') && hit(withGlobs(['a/**/**/x.ts']), 'a/b/c/x.ts') && hit(withGlobs(['a/***/x.ts']), 'a/b/x.ts'),
  );
  assertPass(
    'result shape is { matches, warnings } with both arrays',
    (() => {
      const result = matchExport(registry, {});
      return (
        Object.keys(result).join(',') === 'matches,warnings' &&
        Array.isArray(result.matches) &&
        Array.isArray(result.warnings) &&
        !Array.isArray(result)
      );
    })(),
  );
  assertPass('no warnings for sane registries', matchExport(registry, { symbol: 'x' }).warnings.length === 0);
  assertPass('** inside a segment behaves like *', hit(withGlobs(['a/b**c']), 'a/bxxc') && !hit(withGlobs(['a/b**c']), 'a/bx/xc'));

  // 4. symlinked snapshot and lock, lock repository
  const root = tempDir();
  try {
    copyRuntime(root);
    const real = path.join(root, 'real-snapshot.json');
    fs.moveSync(path.join(root, SNAPSHOT_FILE), real);
    fs.symlinkSync(real, path.join(root, SNAPSHOT_FILE));
    const linkedSnapshot = thrown(() => loadCapabilityRegistry({ runtimeRoot: root }));
    assertPass(
      'symlinked snapshot -> RegistryIntegrityError',
      linkedSnapshot instanceof RegistryIntegrityError && /symlink/.test(linkedSnapshot.message),
    );
    copyRuntime(root);
    fs.removeSync(path.join(root, SNAPSHOT_FILE));
    copyRuntime(root);
    const realLock = path.join(root, 'real-lock.json');
    fs.moveSync(path.join(root, SNAPSHOT_LOCK_FILE), realLock);
    fs.symlinkSync(realLock, path.join(root, SNAPSHOT_LOCK_FILE));
    const linkedLock = thrown(() => loadCapabilityRegistry({ runtimeRoot: root }));
    assertPass(
      'symlinked lock -> RegistryIntegrityError',
      linkedLock instanceof RegistryIntegrityError && /symlink/.test(linkedLock.message),
    );
    fs.removeSync(path.join(root, SNAPSHOT_LOCK_FILE));
    fs.copyFileSync(path.join(REPO_ROOT, SNAPSHOT_LOCK_FILE), path.join(root, SNAPSHOT_LOCK_FILE));
    const lock = fs.readJsonSync(path.join(root, SNAPSHOT_LOCK_FILE));
    fs.writeJsonSync(path.join(root, SNAPSHOT_LOCK_FILE), { ...lock, repository: 'Someone/else' });
    const repo = thrown(() => loadCapabilityRegistry({ runtimeRoot: root }));
    assertPass(
      'lock repository mismatch -> RegistryIntegrityError',
      repo instanceof RegistryIntegrityError && /repository/.test(repo.message),
    );
    const { repository, ...withoutRepository } = lock;
    fs.writeJsonSync(path.join(root, SNAPSHOT_LOCK_FILE), withoutRepository);
    assertPass(
      'lock without repository -> RegistryIntegrityError',
      repository && thrown(() => loadCapabilityRegistry({ runtimeRoot: root })) instanceof RegistryIntegrityError,
    );
  } finally {
    fs.removeSync(root);
  }

  // 5. query trimming and heuristic guard
  assertPass(
    'query is trimmed',
    first(registry, '  cache  ').capability.name === 'cache.typed' && first(registry, '\tauth\n').matchedBy === 'alias',
  );
  assertPass('whitespace-only query -> []', resolveCapability(registry, '   ').length === 0);
  assertPass(
    'single-character query has no heuristic hits',
    resolveCapability(registry, 'e').every((result) => result.matchedBy !== 'heuristic') &&
      resolveCapability(registry, 'i').every((result) => result.matchedBy !== 'heuristic'),
  );
  assertPass(
    'punctuation-only query has no heuristic hits',
    resolveCapability(registry, '..').length === 0 && resolveCapability(registry, '--').length === 0,
  );
  assertPass(
    'two-character query can still use the heuristic',
    resolveCapability(registry, 'ed').some((result) => result.matchedBy === 'heuristic'),
  );

  // 5b. separator normalization (space, hyphen, underscore)
  const sepRegistry = fixture();
  const design = (name, aliases) => ({
    ...sepRegistry.capabilities[0],
    name,
    aliases,
    match: undefined,
    implementations: sepRegistry.capabilities[0].implementations.map((i) => ({ ...i, package: `pkg-${name}` })),
  });
  sepRegistry.capabilities.push(
    design('design.mobile-tokens', ['mobile-tokens']),
    design('design.login-pattern', ['login', 'login-screen']),
  );
  const shape = (query) =>
    resolveCapability(sepRegistry, query)
      .map((r) => `${r.capability.name}:${r.matchedBy}:${r.score}`)
      .join('|');
  const baseline = shape('mobile-tokens');
  assertPass('hyphenated alias resolves', baseline === 'design.mobile-tokens:alias:90', baseline);
  for (const variant of ['mobile tokens', 'Mobile-Tokens', 'mobile_tokens', 'MOBILE  TOKENS', 'mobile - tokens']) {
    assertPass(`'${variant}' resolves like 'mobile-tokens'`, shape(variant) === baseline, shape(variant));
  }
  assertPass(
    'login screen resolves like login-screen',
    shape('login screen') === shape('login-screen') && shape('Login_Screen').startsWith('design.login-pattern:alias'),
  );
  assertPass(
    'separator-normalized prefix keeps prefix score',
    shape('mobile tok') === 'design.mobile-tokens:prefix:40',
    shape('mobile tok'),
  );
  assertPass(
    'no new ties or false positives',
    resolveCapability(sepRegistry, 'mobile tokens').length === 1 &&
      resolveCapability(sepRegistry, 'a b').length === 0 &&
      resolveCapability(sepRegistry, '- _ -').length === 0 &&
      resolveCapability(sepRegistry, '_').length === 0,
  );
  assertPass(
    'contract aliases stay contracts and paths are untouched',
    first(registry, 'platform-core/messaging/event-envelope').matchedBy === 'contract' &&
      first(registry, 'platform core/messaging/event envelope').matchedBy === 'contract' &&
      exportMatches(registry, { filePath: 'schemas/event-envelope.schema.json' }).length === 1,
  );

  // 6. symbol normalization
  const symbolHit = (symbol) =>
    exportMatches(registry, { symbol })
      .map((result) => result.capability.name)
      .join(',');
  assertPass(
    'generic arguments stripped',
    symbolHit('ICacheStore<T>') === 'cache.typed' && symbolHit('ICacheStore<Dictionary<string, int>>') === 'cache.typed',
  );
  assertPass(
    'qualified names reduced to the last segment',
    symbolHit('Hideakisolutions.Platform.Caching.ICacheStore') === 'cache.typed' && symbolHit('Foo::ICacheStore') === 'cache.typed',
  );
  assertPass(
    'registry symbols with generics match plain symbols',
    symbolHit('EventEnvelope') === 'messaging.event-envelope' && symbolHit('Ns.EventEnvelope<TData>') === 'messaging.event-envelope',
  );
  assertPass('normalized match stays case-sensitive', symbolHit('Foo.icachestore') === '' && symbolHit('ICacheStore<T>.x') === '');
  assertPass('whitespace around the symbol is ignored', symbolHit('  ICacheStore ') === 'cache.typed');
}

testSnapshot();
testPathAndRemote();
testValidation();
testResolution();
testMatchExport();
testCorrectionRound();

console.log(`\nCapability registry tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
