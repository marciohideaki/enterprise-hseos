'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { before, after, test } = require('node:test');

const environment = require('../packages/agent-environment');
const { createFrameParser, encodeMessage, FramingError } = require('../packages/agent-environment/framing');
const host = require('../packages/agent-environment/lsp-host');
const { createIsolationPolicy } = require('../packages/agent-isolation-attestation');

const CACHE = process.env.HSEOS_TOOLCHAIN_CACHE || '/build/cache/hseos-toolchain';
const FIXTURE = path.join(__dirname, 'fixtures', 'lsp', 'workspace');
const scratch = [];
let toolchain;

function temp(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(directory);
  return directory;
}

before(() => {
  const destination = temp('hseos-lsp-toolchain-');
  toolchain = environment.prepareLspToolchain({ install: environment.loadPins().installToolchain, cacheDirectory: CACHE, destination });
  assert.equal(toolchain.status, 'ready', 'the pinned toolchain cache must be provisioned for the real-server acceptance');
});

after(() => {
  for (const directory of scratch) fs.rmSync(directory, { recursive: true, force: true });
});

function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    if (entry.isDirectory()) copyTree(from, path.join(target, entry.name));
    else fs.copyFileSync(from, path.join(target, entry.name));
  }
}

function workspace(extra = () => {}) {
  const main = temp('hseos-lsp-main-');
  const root = path.join(main, 'workspace');
  copyTree(FIXTURE, root);
  fs.writeFileSync(path.join(main, 'protected'), 'protected');
  fs.writeFileSync(path.join(main, 'outside.ts'), 'export const outside = 1;\n');
  extra(root, main);
  return { main, root };
}

function policyFor({ main, root }, profile = 'P1') {
  return createIsolationPolicy({
    backend: 'bwrap',
    host_workspace: root,
    main_checkout: main,
    protected_paths: [path.join(main, 'protected')],
    profile,
    toolchain_roots: [toolchain.root],
  });
}

function hashTree(directory) {
  const hash = createHash('sha256');
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      hash.update(`${path.relative(directory, full)}\0${fs.lstatSync(full).mode}\0`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) hash.update(fs.readFileSync(full));
    }
  };
  walk(directory);
  return hash.digest('hex');
}

function realService(spaces, extra = {}) {
  const events = [];
  const service = environment.createDefaultLspService({
    policy: policyFor(spaces),
    toolchain,
    ledger: (event) => events.push(event),
    ...extra,
  });
  return { service, events };
}

// ---------------------------------------------------------------------------------------------------------------
// Real language servers inside the sandbox (acceptance): TypeScript and Python, every action.
// ---------------------------------------------------------------------------------------------------------------

const REAL_CASES = [
  ['typescript', 'diagnostics', { file: 'a.ts' }, (r) => assert.ok(r.diagnostics.some((d) => /not assignable/.test(d.message)))],
  [
    'typescript',
    'definition',
    { file: 'b.ts', position: { line: 1, character: 13 } },
    (r) => assert.ok(r.locations.length > 0 && r.locations.every((l) => !path.isAbsolute(l.path))),
  ],
  [
    'typescript',
    'references',
    { file: 'a.ts', position: { line: 0, character: 17 } },
    (r) => assert.ok(r.locations.some((l) => l.path === 'a.ts')),
  ],
  ['typescript', 'hover', { file: 'a.ts', position: { line: 0, character: 17 } }, (r) => assert.match(r.hover, /greet/)],
  [
    'typescript',
    'rename_preview',
    { file: 'a.ts', position: { line: 0, character: 17 }, new_name: 'hello' },
    (r) => {
      assert.equal(r.rename.applied, false);
      assert.ok(r.rename.files.some((f) => f.path === 'a.ts' && f.edits.every((e) => e.new_text === 'hello')));
    },
  ],
  ['python', 'diagnostics', { file: 'm.py' }, (r) => assert.ok(r.diagnostics.some((d) => /not assignable/.test(d.message)))],
  [
    'python',
    'definition',
    { file: 'm.py', position: { line: 4, character: 7 } },
    (r) =>
      assert.deepEqual(
        r.locations.map((l) => l.path),
        ['m.py'],
      ),
  ],
  ['python', 'references', { file: 'm.py', position: { line: 0, character: 5 } }, (r) => assert.equal(r.locations.length, 2)],
  ['python', 'hover', { file: 'm.py', position: { line: 0, character: 5 } }, (r) => assert.match(r.hover, /greet/)],
  [
    'python',
    'rename_preview',
    { file: 'm.py', position: { line: 0, character: 5 }, new_name: 'hello' },
    (r) => assert.equal(r.rename.files[0].edits.length, 2),
  ],
];

for (const [language, action, input, check] of REAL_CASES) {
  test(`real ${language} server answers ${action} read-only and returns untrusted data`, async () => {
    const spaces = workspace();
    const { service, events } = realService(spaces);
    const before = hashTree(spaces.root);
    const output = await service.run({ action, language, ...input });
    assert.equal(output.status, 'ok', JSON.stringify(output));
    check(output.result);
    assert.equal(hashTree(spaces.root), before, 'workspace hash is identical before and after');
    assert.equal(output.source.authority, 'data');
    assert.equal(output.source.provenance.origin, 'lsp');
    assert.equal(output.source.provenance.trust, 'untrusted');
    assert.match(output.source.provenance.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(output.execution.profile, 'P1');
    assert.equal(output.execution.workspace_access, 'read_only');
    assert.equal(output.execution.descendants_terminated, true);
    assert.ok(output.execution.pids_peak >= 1);
    assert.equal(events.at(-1).type, 'environment.lsp.completed');
    assert.equal(LSP_OUTPUT_PARSES(output), true);
  });
}

function LSP_OUTPUT_PARSES(output) {
  return environment.LSP_OUTPUT_SCHEMA.safeParse(output).success;
}

test('a location outside the workspace root reported by the real server is refused and recorded', async () => {
  const spaces = workspace();
  const { service, events } = realService(spaces);
  // json is defined in pyright's bundled typeshed, which lives in the toolchain mount, not in the workspace.
  const output = await service.run({ action: 'definition', language: 'python', file: 'uses_json.py', position: { line: 2, character: 8 } });
  assert.equal(output.status, 'refused');
  assert.equal(output.code, 'ENV_LSP_OUT_OF_SCOPE');
  assert.equal(events.at(-1).type, 'environment.lsp.refused');
  assert.equal(events.at(-1).code, 'ENV_LSP_OUT_OF_SCOPE');
});

test('a P0 policy cannot host a language server and is reported as blocked', async () => {
  const spaces = workspace();
  const events = [];
  const service = environment.createDefaultLspService({
    policy: policyFor(spaces, 'P0'),
    toolchain,
    ledger: (event) => events.push(event),
  });
  const output = await service.run({ action: 'diagnostics', language: 'python', file: 'm.py' });
  assert.deepEqual([output.status, output.code], ['blocked', 'ENV_LSP_PROFILE_INSUFFICIENT']);
  assert.equal(events.at(-1).type, 'environment.lsp.blocked');
});

// ---------------------------------------------------------------------------------------------------------------
// Controller branches with a scripted executor: scope, validation, failures, normalisation.
// ---------------------------------------------------------------------------------------------------------------

function scripted(spaces, reply, options = {}) {
  const events = [];
  const calls = [];
  const channel = {
    directory: '/unused',
    max_file_bytes: 1,
    verify: options.verify || (() => assert.fail('no artifact expected')),
    dispose: () => {},
  };
  const service = environment.createLspService({
    policy: policyFor(spaces),
    toolchain: options.toolchain || toolchain,
    ledger: (event) => events.push(event),
    createChannel: () => channel,
    now: () => new Date('2026-01-01T00:00:00Z'),
    execute: async (call) => {
      calls.push(call);
      return typeof reply === 'function' ? reply(call) : reply;
    },
  });
  return { service, events, calls };
}

const execution = (stdout, status = 'succeeded') => ({
  status,
  exit_code: status === 'succeeded' ? 0 : 1,
  stdout,
  stderr: '',
  profile: 'P1',
  limits: {},
  pids_peak: 3,
  memory_peak_bytes: 1,
  workspace_access: 'read_only',
  descendants_terminated: true,
});
const hostOk = (result) => execution(JSON.stringify({ ok: true, result }));
const loc = (file, line = 0) => ({
  uri: `file:///workspace/${file}`,
  range: { start: { line, character: 0 }, end: { line, character: 1 } },
});

test('input validation refuses malformed requests before anything runs', async () => {
  const spaces = workspace();
  const { service, calls, events } = scripted(spaces, hostOk({}));
  const bad = [
    null,
    [],
    { action: 'diagnostics', language: 'python', file: 'm.py', extra: 1 },
    { action: 'format', language: 'python', file: 'm.py' },
    { action: 'diagnostics', language: 'ruby', file: 'm.rb' },
    { action: 'diagnostics', language: 'python', file: '' },
    { action: 'diagnostics', language: 'python', file: 'a.ts' },
    { action: 'hover', language: 'python', file: 'm.py' },
    { action: 'hover', language: 'python', file: 'm.py', position: { line: -1, character: 0 } },
    { action: 'rename_preview', language: 'python', file: 'm.py', position: { line: 0, character: 0 }, new_name: '1bad' },
    { action: 'hover', language: 'python', file: 'm.py', position: { line: 0, character: 0 }, new_name: 'x' },
  ];
  for (const input of bad) assert.equal((await service.run(input)).code, 'ENV_LSP_INPUT_INVALID', JSON.stringify(input));
  assert.equal(calls.length, 0);
  assert.equal(events.length, bad.length);
  assert.equal(environment.LSP_INPUT_SCHEMA.safeParse({ action: 'diagnostics', language: 'python', file: 'm.py' }).success, true);
  assert.equal(environment.LSP_OUTPUT_SCHEMA.safeParse({}).success, false);
});

test('files outside the root (.., absolute, symlink) are refused and recorded without launching a server', async () => {
  const spaces = workspace((root, main) => {
    fs.symlinkSync(path.join(main, 'outside.ts'), path.join(root, 'link.ts'));
    fs.symlinkSync(path.join(root, 'a.ts'), path.join(root, 'inside.ts'));
    fs.mkdirSync(path.join(root, 'dir.ts'));
  });
  const { service, calls, events } = scripted(spaces, hostOk({ diagnostics: [] }));
  for (const file of ['../outside.ts', 'sub/../../outside.ts', path.join(spaces.main, 'outside.ts'), 'link.ts']) {
    const output = await service.run({ action: 'diagnostics', language: 'typescript', file });
    assert.deepEqual([output.status, output.code], ['refused', 'ENV_LSP_OUT_OF_SCOPE'], file);
  }
  assert.equal((await service.run({ action: 'diagnostics', language: 'typescript', file: 'missing.ts' })).code, 'ENV_LSP_INPUT_INVALID');
  assert.equal((await service.run({ action: 'diagnostics', language: 'typescript', file: 'dir.ts' })).code, 'ENV_LSP_INPUT_INVALID');
  assert.equal(calls.length, 0);
  assert.equal(events.filter((event) => event.code === 'ENV_LSP_OUT_OF_SCOPE').length, 4);
  // A symlink that stays inside the root is allowed and is sent by its real in-root path.
  const ok = await service.run({ action: 'diagnostics', language: 'typescript', file: 'inside.ts' });
  assert.equal(ok.status, 'ok');
  assert.equal(JSON.parse(calls[0].command[2]).file, 'a.ts');
  assert.equal(JSON.parse(calls[0].command[2]).scratch, '/dev/shm', 'server HOME and TMPDIR point at the private sandbox tmpfs');
  assert.equal(calls[0].limits.shm_bytes, 67_108_864);
});

test('a missing toolchain, pin or server binary is BLOCKED with its cause, never an empty result', async () => {
  const spaces = workspace();
  const input = { action: 'diagnostics', language: 'python', file: 'm.py' };
  const unready = scripted(spaces, hostOk({}), {
    toolchain: { status: 'blocked', code: 'ENV_TOOLCHAIN_ARTIFACT_MISSING', cause: 'artifact for pyright is absent' },
  });
  const blockedOutput = await unready.service.run(input);
  assert.deepEqual(
    [blockedOutput.status, blockedOutput.code, blockedOutput.cause],
    ['blocked', 'ENV_TOOLCHAIN_ARTIFACT_MISSING', 'artifact for pyright is absent'],
  );
  const empty = temp('hseos-lsp-empty-');
  const absent = scripted(spaces, hostOk({}), { toolchain: { status: 'ready', root: empty } });
  const output = await absent.service.run(input);
  assert.deepEqual([output.status, output.code], ['blocked', 'ENV_LSP_SERVER_UNAVAILABLE']);
  assert.equal(absent.calls.length, 0);
  // The host reporting that the server vanished or crashed on start is also BLOCKED.
  const exited = scripted(spaces, execution(JSON.stringify({ ok: false, code: 'ENV_LSP_SERVER_EXITED' }), 'failed'));
  assert.equal((await exited.service.run(input)).status, 'blocked');
  const missing = environment.prepareLspToolchain({
    install: () => {
      throw Object.assign(new Error('cache is not configured'), { code: 'ENV_TOOLCHAIN_CACHE_UNSET' });
    },
    destination: temp('hseos-lsp-blocked-'),
  });
  assert.deepEqual([missing.status, missing.code], ['blocked', 'ENV_TOOLCHAIN_CACHE_UNSET']);
  const generic = environment.prepareLspToolchain({
    install: () => {
      throw new Error('boom');
    },
    destination: temp('hseos-lsp-blocked-'),
  });
  assert.equal(generic.code, 'ENV_TOOLCHAIN_BLOCKED');
});

test('executor failures and unreadable host output are refused with a stable code', async () => {
  const spaces = workspace();
  const input = { action: 'diagnostics', language: 'python', file: 'm.py' };
  for (const [reply, code] of [
    [execution('', 'timed_out'), 'ENV_LSP_TIMED_OUT'],
    [execution('not json'), 'ENV_LSP_OUTPUT_INVALID'],
    [execution(JSON.stringify({ ok: false, code: 'ENV_LSP_TIMEOUT' }), 'failed'), 'ENV_LSP_TIMEOUT'],
    [execution(JSON.stringify({ ok: false }), 'failed'), 'ENV_LSP_FAILED'],
  ]) {
    const output = await scripted(spaces, reply).service.run(input);
    assert.deepEqual([output.status, output.code], ['refused', code]);
  }
});

test('a large host result arrives through the artifact channel and only a verified manifest is accepted', async () => {
  const spaces = workspace();
  const input = { action: 'hover', language: 'python', file: 'm.py', position: { line: 0, character: 5 } };
  const body = Buffer.from(JSON.stringify({ ok: true, result: { action: 'hover', hover: 'from the artifact' } }));
  const manifest = JSON.stringify([{ path: '/artifacts/result.json', media_type: 'application/json', bytes: body.length, sha256: 'x' }]);
  let verified;
  const good = scripted(spaces, execution(manifest), {
    verify: (text) => {
      verified = text;
      return [{ content: body }];
    },
  });
  assert.equal((await good.service.run(input)).result.hover, 'from the artifact');
  assert.equal(verified, manifest);
  const diverged = scripted(spaces, execution(manifest), {
    verify: () => {
      throw new Error('digest diverges');
    },
  });
  assert.equal((await diverged.service.run(input)).code, 'ENV_LSP_OUTPUT_INVALID');
});

test('every reported location is mapped to a root-relative path or the whole call is refused', async () => {
  const spaces = workspace((root, main) => {
    fs.symlinkSync(path.join(main, 'outside.ts'), path.join(root, 'escape.ts'));
    fs.symlinkSync(path.join(root, 'a.ts'), path.join(root, 'alias.ts'));
  });
  const input = { action: 'references', language: 'typescript', file: 'a.ts', position: { line: 0, character: 17 } };
  const run = async (raw, overrides = input) => scripted(spaces, hostOk(raw)).service.run(overrides);
  const ok = await run({
    action: 'references',
    locations: [
      loc('a.ts'),
      loc('alias.ts'),
      loc('gone.ts'),
      { targetUri: 'file:///workspace/b.ts', targetSelectionRange: loc('b.ts').range },
    ],
  });
  assert.deepEqual(
    ok.result.locations.map((l) => l.path),
    ['a.ts', 'a.ts', 'gone.ts', 'b.ts'],
  );
  const rootLocation = await run({ action: 'references', locations: [{ uri: 'file:///workspace', range: loc('a.ts').range }] });
  assert.equal(rootLocation.result.locations[0].path, '.');
  for (const uri of [
    'file:///etc/passwd',
    'file:///workspace/escape.ts',
    'file:///workspace/../etc/passwd',
    'file://remote/workspace/a.ts',
    'file:///workspacefoo/a.ts',
    'file:///opt/hseos/toolchain/x.py',
  ]) {
    const output = await run({ action: 'references', locations: [{ uri, range: loc('a.ts').range }] });
    assert.deepEqual([output.status, output.code], ['refused', 'ENV_LSP_OUT_OF_SCOPE'], uri);
  }
  const plain = await run({ action: 'definition', locations: [loc('a.ts')] }, { ...input, action: 'definition' });
  assert.equal(plain.result.locations.length, 1);
});

test('targets that do not exist yet are resolved through their existing ancestor and symlinks before the scope check', async () => {
  const spaces = workspace((root, main) => {
    fs.mkdirSync(path.join(main, 'outside-dir'));
    fs.symlinkSync(path.join(main, 'outside-dir'), path.join(root, 'linkdir'));
    fs.symlinkSync(path.join(main, 'not-yet.py'), path.join(root, 'dangling.py'));
    fs.symlinkSync('ghost-inside.py', path.join(root, 'dangling-in.py'));
    fs.symlinkSync('chain2.py', path.join(root, 'chain1.py'));
    fs.symlinkSync('../outside.ts', path.join(root, 'chain2.py'));
    fs.symlinkSync('loop.py', path.join(root, 'loop.py'));
  });
  const rename = { action: 'rename_preview', language: 'python', file: 'm.py', position: { line: 0, character: 5 }, new_name: 'hello' };
  const operation = (kind, uri, newUri) =>
    hostOk({ action: 'rename_preview', edit: { documentChanges: [{ kind, uri, oldUri: uri, ...(newUri ? { newUri } : {}) }] } });
  const run = (reply, input = rename) => scripted(spaces, reply).service.run(input);
  const outside = (output) => assert.deepEqual([output.status, output.code], ['refused', 'ENV_LSP_OUT_OF_SCOPE'], JSON.stringify(output));
  outside(await run(operation('create', 'file:///workspace/linkdir/new.py')));
  outside(await run(operation('create', 'file:///workspace/linkdir/deeper/still/new.py')));
  outside(await run(operation('rename', 'file:///workspace/m.py', 'file:///workspace/dangling.py')));
  outside(await run(operation('rename', 'file:///workspace/m.py', 'file:///workspace/linkdir/renamed.py')));
  outside(await run(operation('delete', 'file:///workspace/chain1.py')));
  outside(await run(operation('delete', 'file:///workspace/loop.py')));
  const references = { action: 'references', language: 'python', file: 'm.py', position: { line: 0, character: 5 } };
  for (const uri of [
    'file:///workspace/linkdir/new.py',
    'file:///workspace/dangling.py',
    'file:///workspace/chain1.py',
    'file:///workspace/loop.py',
  ]) {
    outside(await run(hostOk({ action: 'references', locations: [{ uri, range: loc('m.py').range }] }), references));
  }
  // Percent-encoded dot segments are decoded before the check and leave the root.
  for (const uri of [
    'file:///workspace/%2e%2e/outside.ts',
    'file:///workspace/sub/%2E%2E/%2e%2e/x.py',
    'file:///workspace/..%2foutside.ts',
  ]) {
    outside(await run(hostOk({ action: 'references', locations: [{ uri, range: loc('m.py').range }] }), references));
  }
  // Only the path segments of a file: URI are decoded: an invalid escape is refused, an escaped dot segment is a parent
  // segment in any case, and a plain path is literal (a '%' in a name is not an escape).
  for (const uri of ['file:///workspace/%zz/x.py', 'file:///workspace/%2E%2e/x.py', 'file:///workspace/a/%2e%2E/%2e%2e/x.py']) {
    outside(await run(hostOk({ action: 'references', locations: [{ uri, range: loc('m.py').range }] }), references));
  }
  const escaped = await run(
    hostOk({ action: 'references', locations: [{ uri: 'file:///workspace/with%20space.py', range: loc('m.py').range }] }),
    references,
  );
  assert.equal(escaped.result?.locations?.[0]?.path, 'with space.py', 'a valid escape in a file: segment is decoded');
  const literal = await run(
    hostOk({ action: 'references', locations: [{ uri: '/workspace/100%/x.py', range: loc('m.py').range }] }),
    references,
  );
  assert.equal(literal.result?.locations?.[0]?.path, '100%/x.py', 'a plain path with a lone % is literal, not invalid text');
  for (const query of ['file:///workspace/ok.py?q=%zz', 'file:///workspace/ok.py#%zz']) {
    const output = await run(hostOk({ action: 'references', locations: [{ uri: query, range: loc('m.py').range }] }), references);
    assert.equal(output.result?.locations?.[0]?.path, 'ok.py', `the query or fragment is not part of the path: ${query}`);
  }
  // A pending link that stays inside the root is in scope and reported by the path it would create.
  const inside = await run(operation('create', 'file:///workspace/dangling-in.py'));
  assert.equal(inside.status, 'ok');
  assert.equal(inside.result.rename.resource_operations[0].path, 'ghost-inside.py');
  const fresh = await run(operation('create', 'file:///workspace/new-dir/new.py'));
  assert.equal(fresh.result.rename.resource_operations[0].path, 'new-dir/new.py');
  // The same chain as the requested file is refused before any server runs.
  const { service, calls } = scripted(spaces, hostOk({ diagnostics: [] }));
  for (const file of ['chain1.py', 'loop.py', 'linkdir/new.py']) {
    const output = await service.run({ action: 'diagnostics', language: 'python', file });
    assert.equal(output.status, 'refused', file);
    assert.ok(['ENV_LSP_OUT_OF_SCOPE', 'ENV_LSP_INPUT_INVALID'].includes(output.code), `${file}: ${output.code}`);
  }
  assert.equal(calls.length, 0);
});

test('the sandbox really mounts the workspace and the toolchain read-only (EROFS), not just by label', async () => {
  const spaces = workspace();
  const policy = policyFor(spaces);
  const { executeIsolatedCommand } = require('../packages/agent-isolation-attestation/executor');
  const before = hashTree(spaces.root);
  const attempt = async (target) =>
    executeIsolatedCommand({
      policy,
      command: ['/usr/bin/python3', '-I', '-c', `open(${JSON.stringify(target)}, 'w').write('x')`],
      timeout_ms: 20_000,
      max_output_bytes: 65_536,
      readonly_mounts: [{ source: toolchain.root, target: '/opt/hseos/toolchain' }],
    });
  for (const target of ['/workspace/created-by-server.txt', '/workspace/a.ts', '/opt/hseos/toolchain/host/lsp-host.js']) {
    const result = await attempt(target);
    assert.equal(result.status, 'failed', target);
    assert.match(result.stderr, /Read-only file system/, target);
  }
  assert.equal(hashTree(spaces.root), before);
  // The private tmpfs the server uses for HOME and TMPDIR stays writable.
  const scratch = await executeIsolatedCommand({
    policy,
    command: ['/usr/bin/python3', '-I', '-c', "open('/dev/shm/ok', 'w').write('x')"],
    timeout_ms: 20_000,
    max_output_bytes: 65_536,
    limits: { shm_bytes: 67_108_864 },
  });
  assert.equal(scratch.status, 'succeeded');
});

test('P0 forbids child processes with pipes (spawn EPERM) while P1 allows them: the reason LSP needs P1', async () => {
  const { executeIsolatedCommand } = require('../packages/agent-isolation-attestation/executor');
  const probe =
    "const c=require('child_process').spawn('/usr/bin/cat',[],{stdio:['pipe','pipe','ignore']});c.on('error',e=>console.log('ERR',e.code));c.stdout.on('data',d=>{console.log('ECHO',String(d));c.kill()});c.stdin.write('hi')";
  const outcome = async (profile) =>
    executeIsolatedCommand({
      policy: policyFor(workspace(), profile),
      command: ['/usr/bin/node', '-e', probe],
      host_node: true,
      timeout_ms: 20_000,
      max_output_bytes: 65_536,
    });
  const p0 = await outcome('P0');
  assert.equal(p0.status, 'failed');
  assert.match(p0.stderr, /spawn EPERM/);
  const p1 = await outcome('P1');
  assert.equal(p1.status, 'succeeded');
  assert.match(p1.stdout, /ECHO hi/);
});

test('diagnostics, hover and rename previews are normalised, bounded and never applied', async () => {
  const spaces = workspace();
  const hover = { action: 'hover', language: 'python', file: 'm.py', position: { line: 0, character: 5 } };
  const long = 'x'.repeat(5000);
  const clipped = await scripted(spaces, hostOk({ action: 'hover', hover: long })).service.run(hover);
  assert.ok(clipped.result.hover.endsWith('[truncated]') && clipped.result.hover.length < 4200);
  assert.deepEqual([clipped.result.truncated, clipped.result.original_length], [true, 5000]);
  const whole = await scripted(spaces, hostOk({ action: 'hover', hover: 'short' })).service.run(hover);
  assert.deepEqual([whole.result.hover, whole.result.truncated, whole.result.original_length], ['short', false, undefined]);
  const diagnostics = await scripted(
    spaces,
    hostOk({ action: 'diagnostics', diagnostics: [{ range: loc('m.py').range, message: 'bare' }] }),
  ).service.run({
    action: 'diagnostics',
    language: 'python',
    file: 'm.py',
  });
  assert.deepEqual(
    [diagnostics.result.diagnostics[0].severity, diagnostics.result.diagnostics[0].code, diagnostics.result.diagnostics[0].source],
    [null, null, null],
  );
  assert.deepEqual(
    [diagnostics.result.total, diagnostics.result.truncated, diagnostics.result.diagnostics[0].truncated],
    [1, false, false],
  );
  const longMessage = await scripted(
    spaces,
    hostOk({ action: 'diagnostics', total: 500, diagnostics: [{ range: loc('m.py').range, message: long }] }),
  ).service.run({
    action: 'diagnostics',
    language: 'python',
    file: 'm.py',
  });
  assert.deepEqual(
    [
      longMessage.result.diagnostics[0].truncated,
      longMessage.result.diagnostics[0].original_length,
      longMessage.result.total,
      longMessage.result.truncated,
    ],
    [true, 5000, 500, true],
    'a cut message and a cut list are both flagged',
  );

  const rename = { action: 'rename_preview', language: 'python', file: 'm.py', position: { line: 0, character: 5 }, new_name: 'hello' };
  const edit = (uri, newText = 'hello') => ({ range: loc('m.py').range, newText });
  const changes = await scripted(
    spaces,
    hostOk({ action: 'rename_preview', edit: { changes: { 'file:///workspace/m.py': [edit()] } } }),
  ).service.run(rename);
  assert.equal(changes.result.rename.applied, false);
  assert.equal(changes.result.rename.truncated, false);
  const cutEdit = await scripted(
    spaces,
    hostOk({ action: 'rename_preview', edit: { changes: { 'file:///workspace/m.py': [edit('', long)] } } }),
  ).service.run(rename);
  const [cut] = cutEdit.result.rename.files[0].edits;
  assert.deepEqual([cutEdit.result.rename.truncated, cut.truncated, cut.original_length], [true, true, 5000]);
  assert.deepEqual(
    changes.result.rename.files.map((f) => f.path),
    ['m.py'],
  );
  const documentChanges = await scripted(
    spaces,
    hostOk({
      action: 'rename_preview',
      edit: {
        documentChanges: [
          { textDocument: { uri: 'file:///workspace/m.py' }, edits: [edit()] },
          { kind: 'rename', oldUri: 'file:///workspace/m.py', newUri: 'file:///workspace/n.py' },
          { kind: 'delete', uri: 'file:///workspace/a.ts' },
        ],
      },
    }),
  ).service.run(rename);
  assert.deepEqual(documentChanges.result.rename.resource_operations, [
    { kind: 'rename', path: 'm.py', new_path: 'n.py' },
    { kind: 'delete', path: 'a.ts' },
  ]);
  const empty = await scripted(spaces, hostOk({ action: 'rename_preview', edit: {} })).service.run(rename);
  assert.deepEqual(empty.result.rename.files, []);
  const escaped = await scripted(
    spaces,
    hostOk({ action: 'rename_preview', edit: { changes: { 'file:///etc/hosts': [edit()] } } }),
  ).service.run(rename);
  assert.equal(escaped.code, 'ENV_LSP_OUT_OF_SCOPE');
  const many = Array.from({ length: 2001 }, () => edit());
  const tooMany = await scripted(
    spaces,
    hostOk({ action: 'rename_preview', edit: { changes: { 'file:///workspace/m.py': many } } }),
  ).service.run(rename);
  assert.equal(tooMany.code, 'ENV_LSP_RESULT_TOO_LARGE');
  const broken = await scripted(spaces, hostOk({ action: 'rename_preview' })).service.run(rename);
  assert.equal(broken.code, 'ENV_LSP_RESULT_INVALID');
});

test('the default service wires the real executor and artifact channel lazily', () => {
  const { service } = realService(workspace());
  assert.equal(typeof service.run, 'function');
  assert.equal(Object.isFrozen(service), true);
  assert.equal(typeof environment.canonical, 'function');
  assert.equal(environment.canonical({ b: [1, { d: 1, c: 2 }], a: null }), '{"a":null,"b":[1,{"c":2,"d":1}]}');
  assert.equal(new environment.LspError('m', 'C').code, 'C');
});

// ---------------------------------------------------------------------------------------------------------------
// Framing (shared with the DAP client).
// ---------------------------------------------------------------------------------------------------------------

test('Content-Length framing round-trips, reassembles split chunks and refuses every violation', () => {
  const first = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'a' });
  const second = encodeMessage({ jsonrpc: '2.0', id: 2, text: 'ação' });
  const parser = createFrameParser();
  const all = Buffer.concat([first, second]);
  const out = [];
  for (let index = 0; index < all.length; index += 7) out.push(...parser.push(all.subarray(index, index + 7)));
  assert.deepEqual(
    out.map((m) => m.id),
    [1, 2],
  );
  assert.equal(out[1].text, 'ação');
  assert.deepEqual(createFrameParser().push(Buffer.alloc(0)), []);

  const frame = (header, body = '{}') => Buffer.from(`${header}\r\n\r\n${body}`);
  const refuse = (buffer, code, options) =>
    assert.throws(
      () => createFrameParser(options).push(buffer),
      (error) => error instanceof FramingError && error.code === code,
    );
  refuse(frame('Content-Length: 2\r\nContent-Length: 2'), 'ENV_FRAMING_INVALID');
  refuse(frame('Content-Length: abc'), 'ENV_FRAMING_INVALID');
  refuse(frame('Content-Type: x'), 'ENV_FRAMING_INVALID');
  refuse(frame('no separator here'), 'ENV_FRAMING_INVALID');
  refuse(frame('Content-Length: 4', 'nope'), 'ENV_FRAMING_INVALID');
  refuse(frame('Content-Length: 99999999'), 'ENV_FRAMING_TOO_LARGE');
  refuse(frame('Content-Length: 5'.padEnd(2000, ' ')), 'ENV_FRAMING_INVALID');
  refuse(Buffer.alloc(2000, 0x41), 'ENV_FRAMING_INVALID');
  refuse(frame('Content-Length: 20'), 'ENV_FRAMING_TOO_LARGE', { maxBodyBytes: 10 });
  assert.deepEqual(createFrameParser().push(frame('Content-Length: 2', '{}')), [{}]);
  assert.deepEqual(createFrameParser().push(frame('content-length: 2', '{}')), [{}]);
});

// ---------------------------------------------------------------------------------------------------------------
// Host process (in-process here so it is measured): real servers plus scripted fakes for protocol failures.
// ---------------------------------------------------------------------------------------------------------------

function fakeToolchain(script) {
  const root = temp('hseos-lsp-fake-');
  const entry = path.join(root, 'pyright/package/langserver.index.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, script);
  return root;
}

const FAKE_PRELUDE = `
const frame = (m) => { const b = Buffer.from(JSON.stringify(m)); return Buffer.concat([Buffer.from('Content-Length: ' + b.length + '\\r\\n\\r\\n'), b]); };
let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\\r\\n\\r\\n');
    if (end < 0) return;
    const length = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    onMessage(message);
  }
});
`;

const hostRequest = (root, toolchainRoot, extra = {}) => ({
  language: 'python',
  action: 'hover',
  file: 'm.py',
  position: { line: 0, character: 5 },
  root,
  toolchain: toolchainRoot,
  timeout_ms: 5000,
  ...extra,
});

test('host reports protocol failures with stable codes', async () => {
  const { root } = workspace();
  const code = async (script, extra) => {
    try {
      await host.runAction(hostRequest(root, fakeToolchain(script), extra));
      return 'resolved';
    } catch (error) {
      return error.code;
    }
  };
  assert.equal(await code('process.exit(0)'), 'ENV_LSP_SERVER_EXITED');
  assert.equal(await code('process.stdout.write("garbage\\r\\n\\r\\n")\nsetInterval(() => {}, 1000)'), 'ENV_LSP_PROTOCOL');
  assert.equal(await code('setInterval(() => {}, 1000)', { timeout_ms: 300 }), 'ENV_LSP_TIMEOUT');
  assert.equal(
    await code(
      `${FAKE_PRELUDE}function onMessage(m) { if (m.id !== undefined) process.stdout.write(frame({ jsonrpc: '2.0', id: m.id, error: { code: -1, message: 'no' } })); }`,
    ),
    'ENV_LSP_SERVER_ERROR',
  );
  // A server that never publishes diagnostics times out instead of returning an empty list.
  assert.equal(
    await code(
      `${FAKE_PRELUDE}function onMessage(m) { if (m.id !== undefined) process.stdout.write(frame({ jsonrpc: '2.0', id: m.id, result: {} })); }`,
      { action: 'diagnostics', position: undefined, timeout_ms: 600 },
    ),
    'ENV_LSP_TIMEOUT',
  );
  assert.equal(await code('process.exit(0)', { action: 'format' }), 'ENV_LSP_INPUT');
  assert.equal(await code('process.exit(0)', { language: 'ruby' }), 'ENV_LSP_INPUT');
});

test('host answers server requests, accepts null results and shuts the server down', async () => {
  const { root } = workspace();
  const script = `${FAKE_PRELUDE}
function onMessage(m) {
  if (m.method === 'initialize') {
    process.stdout.write(frame({ jsonrpc: '2.0', id: 100, method: 'workspace/configuration', params: { items: [{}, {}] } }));
    process.stdout.write(frame({ jsonrpc: '2.0', id: 101, method: 'client/registerCapability', params: {} }));
    process.stdout.write(frame({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file://' + process.cwd() + '/m.py', diagnostics: [{ message: 'd' }] } }));
    process.stdout.write(frame({ jsonrpc: '2.0', id: m.id, result: { capabilities: {} } }));
  } else if (m.method === 'textDocument/definition') {
    process.stdout.write(frame({ jsonrpc: '2.0', id: m.id, result: null }));
  } else if (m.method === 'textDocument/references') {
    process.stdout.write(frame({ jsonrpc: '2.0', id: m.id, result: null }));
  } else if (m.method === 'textDocument/hover') {
    process.stdout.write(frame({ jsonrpc: '2.0', id: m.id, result: { contents: [{ value: 'a' }, 'b', { kind: 1 }] } }));
  } else if (m.method === 'textDocument/rename') {
    process.stdout.write(frame({ jsonrpc: '2.0', id: m.id, result: null }));
  } else if (m.id !== undefined) {
    process.stdout.write(frame({ jsonrpc: '2.0', id: m.id, result: null }));
  }
}`;
  const toolchainRoot = fakeToolchain(script);
  const run = (extra) => host.runAction(hostRequest(root, toolchainRoot, extra));
  assert.deepEqual((await run({ action: 'definition' })).locations, []);
  assert.equal((await run({ action: 'definition' })).total, 0);
  assert.deepEqual((await run({ action: 'references' })).locations, []);
  assert.equal((await run({ action: 'hover' })).hover, 'a\nb\n');
  assert.deepEqual((await run({ action: 'rename_preview', new_name: 'z' })).edit, {});
  assert.deepEqual(
    (await run({ action: 'diagnostics' })).diagnostics.map((d) => d.message),
    ['d'],
  );
  assert.equal(host.hoverText(), '');
  assert.equal(host.hoverText(null), '');
});

test('host lists are bounded and report the real total', () => {
  const items = Array.from({ length: 450 }, (_, index) => index);
  const cut = host.bounded('references', 'locations', items);
  assert.deepEqual([cut.locations.length, cut.total], [200, 450]);
});

test('host output is inline when small and a verified artifact manifest when large', async () => {
  const lines = [];
  const small = { ok: true, result: { hover: 'x' } };
  host.emit(small, (line) => lines.push(line), null);
  assert.deepEqual(JSON.parse(lines[0]), small);
  const large = { ok: true, result: { hover: 'y'.repeat(60_000) } };
  host.emit(large, (line) => lines.push(line), null);
  assert.equal(JSON.parse(lines[1]).result.hover.length, 60_000, 'without an artifact directory the host cannot offload');
  const directory = temp('hseos-lsp-artifacts-');
  host.emit(large, (line) => lines.push(line), directory);
  const [entry] = JSON.parse(lines[2]);
  const bytes = fs.readFileSync(path.join(directory, 'result.json'));
  assert.deepEqual(entry, {
    path: '/artifacts/result.json',
    media_type: 'application/json',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  assert.deepEqual(JSON.parse(bytes), large);
});

test('host main prints ok on success and a stable code on failure', async () => {
  const { root } = workspace();
  const lines = [];
  const write = (line) => lines.push(JSON.parse(line));
  assert.equal(await host.main([JSON.stringify(hostRequest(root, toolchain.root, { action: 'hover' }))], write, null), 0);
  assert.equal(lines[0].ok, true);
  assert.match(lines[0].result.hover, /greet/);
  assert.equal(await host.main(['{"language":"python"}'], write, null), 1);
  assert.deepEqual(lines[1], { ok: false, code: 'ENV_LSP_INPUT' });
  assert.equal(await host.main(['not json'], write, null), 1);
  assert.equal(lines[2].code, 'ENV_LSP_HOST_FAILURE');
});

// ---------------------------------------------------------------------------------------------------------------
// Toolchain pins: the real cache verifies; small fixture caches exercise every BLOCKED branch.
// ---------------------------------------------------------------------------------------------------------------

const pins = require('../tools/lib/environment-toolchain-pins');
const { execFileSync } = require('node:child_process');

test('the real cache verifies SHA-256 and licence text inside each pinned artifact and installs offline', () => {
  assert.deepEqual(
    toolchain.pins.map((pin) => [pin.name, pin.version, pin.license]),
    [
      ['typescript-language-server', '6.0.2', 'Apache-2.0'],
      ['typescript', '5.9.3', 'Apache-2.0'],
      ['pyright', '1.1.414', 'MIT'],
    ],
  );
  for (const entry of [
    'typescript-language-server/package/lib/cli.mjs',
    'typescript/package/lib/tsserver.js',
    'pyright/package/langserver.index.js',
    'host/lsp-host.js',
    'host/framing.js',
  ]) {
    assert.ok(fs.existsSync(path.join(toolchain.root, entry)), entry);
  }
  assert.throws(() => pins.installToolchain({ cacheDirectory: CACHE, destination: temp('hseos-lsp-x-'), names: ['no-such-pin'] }), {
    code: 'ENV_TOOLCHAIN_PIN_UNKNOWN',
  });
});

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Build a one-pin cache: a tgz holding `package/<file>` entries plus a manifest that matches (or deliberately not). */
function fixtureCache({
  files = { 'package/LICENSE': 'Permission is hereby granted, free of charge' },
  mutate = (manifest) => manifest,
  link = false,
  outside = false,
} = {}) {
  const cache = temp('hseos-lsp-cache-');
  const source = temp('hseos-lsp-src-');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    fs.writeFileSync(path.join(source, name), content);
  }
  if (link) fs.symlinkSync('/etc/passwd', path.join(source, 'package/link'));
  if (outside) fs.writeFileSync(path.join(source, 'stray'), 'x');
  fs.mkdirSync(path.join(cache, 'npm'));
  const artifact = path.join(cache, 'npm/fixture-1.0.0.tgz');
  execFileSync('tar', ['-czf', artifact, '-C', source, ...fs.readdirSync(source)]);
  const expected = {
    fixture: {
      version: '1.0.0',
      artifact: 'npm/fixture-1.0.0.tgz',
      sha256: sha(fs.readFileSync(artifact)),
      license: 'MIT',
      license_file: 'package/LICENSE',
      license_markers: ['Permission is hereby granted, free of charge'],
      license_sha256: sha(Buffer.from('Permission is hereby granted, free of charge')),
    },
  };
  const manifest = {
    schema: 'hseos.toolchain-cache.v1',
    runtime_download: false,
    pins: [{ name: 'fixture', version: '1.0.0', artifact: 'npm/fixture-1.0.0.tgz', license: 'MIT', sha256: expected.fixture.sha256 }],
  };
  fs.writeFileSync(path.join(cache, 'toolchain-manifest.json'), JSON.stringify(mutate(manifest)));
  return { cache, expected, artifact };
}

const install =
  (cache, expected, names = ['fixture']) =>
  () =>
    pins.installToolchain({ cacheDirectory: cache, destination: temp('hseos-lsp-dest-'), names, expected });

test('a coherent fixture cache installs and every divergence is BLOCKED with its own code', () => {
  const good = fixtureCache();
  const result = pins.installToolchain({
    cacheDirectory: good.cache,
    destination: temp('hseos-lsp-dest-'),
    names: ['fixture'],
    expected: good.expected,
  });
  assert.equal(result.status, 'ready');
  assert.ok(fs.existsSync(path.join(result.root, 'fixture/package/LICENSE')));

  const cases = [
    ['ENV_TOOLCHAIN_MANIFEST_INVALID', fixtureCache({ mutate: (m) => ({ ...m, runtime_download: true }) })],
    ['ENV_TOOLCHAIN_MANIFEST_INVALID', fixtureCache({ mutate: () => null })],
    ['ENV_TOOLCHAIN_PIN_MISSING', fixtureCache({ mutate: (m) => ({ ...m, pins: [] }) })],
    ['ENV_TOOLCHAIN_PIN_DIVERGED', fixtureCache({ mutate: (m) => ({ ...m, pins: [{ ...m.pins[0], version: '9.9.9' }] }) })],
    [
      'ENV_TOOLCHAIN_DIGEST_MISMATCH',
      (() => {
        const f = fixtureCache();
        f.expected.fixture.sha256 = 'f'.repeat(64);
        const manifest = JSON.parse(fs.readFileSync(path.join(f.cache, 'toolchain-manifest.json')));
        manifest.pins[0].sha256 = 'f'.repeat(64);
        fs.writeFileSync(path.join(f.cache, 'toolchain-manifest.json'), JSON.stringify(manifest));
        return f;
      })(),
    ],
    [
      'ENV_TOOLCHAIN_ARTIFACT_MISSING',
      (() => {
        const f = fixtureCache();
        fs.rmSync(f.artifact);
        return f;
      })(),
    ],
    ['ENV_TOOLCHAIN_LICENSE_MISSING', fixtureCache({ files: { 'package/README': 'no licence' } })],
    ['ENV_TOOLCHAIN_LICENSE_MISMATCH', fixtureCache({ files: { 'package/LICENSE': 'All rights reserved' } })],
    // The markers are all present, so only the digest of the whole text can tell this licence from the pinned one.
    [
      'ENV_TOOLCHAIN_LICENSE_DIGEST',
      fixtureCache({ files: { 'package/LICENSE': 'Permission is hereby granted, free of charge, to anyone, for any use at all' } }),
    ],
    // Fail-closed: a pin that carries no licence digest is never accepted on its markers alone.
    [
      'ENV_TOOLCHAIN_LICENSE_DIGEST',
      (() => {
        const f = fixtureCache();
        delete f.expected.fixture.license_sha256;
        return f;
      })(),
    ],
    // The whole digest is compared: this one agrees with the pinned value on its first 20 characters and differs after.
    [
      'ENV_TOOLCHAIN_LICENSE_DIGEST',
      (() => {
        const f = fixtureCache();
        const real = f.expected.fixture.license_sha256;
        f.expected.fixture.license_sha256 = `${real.slice(0, 20)}${real[20] === '0' ? '1' : '0'}${real.slice(21)}`;
        return f;
      })(),
    ],
    ['ENV_TOOLCHAIN_ARCHIVE_UNSAFE', fixtureCache({ link: true })],
    ['ENV_TOOLCHAIN_ARCHIVE_UNSAFE', fixtureCache({ outside: true })],
  ];
  for (const [code, fixture] of cases) assert.throws(install(fixture.cache, fixture.expected), { code }, code);

  const escaping = fixtureCache();
  escaping.expected.fixture.artifact = '../escape.tgz';
  const manifest = JSON.parse(fs.readFileSync(path.join(escaping.cache, 'toolchain-manifest.json')));
  manifest.pins[0].artifact = '../escape.tgz';
  fs.writeFileSync(path.join(escaping.cache, 'toolchain-manifest.json'), JSON.stringify(manifest));
  assert.throws(install(escaping.cache, escaping.expected), { code: 'ENV_TOOLCHAIN_ARTIFACT_PATH' });
  assert.throws(install(temp('hseos-lsp-nocache-'), good.expected), { code: 'ENV_TOOLCHAIN_MANIFEST_MISSING' });
  assert.throws(install(path.join(good.cache, 'toolchain-manifest.json'), good.expected), { code: 'ENV_TOOLCHAIN_MANIFEST_MISSING' });
});

test('the cache location is configuration: unset or relative means BLOCKED, the environment variable is honoured', () => {
  const saved = process.env[pins.CACHE_ENV];
  try {
    delete process.env[pins.CACHE_ENV];
    assert.throws(() => pins.resolveCacheDirectory(), { code: 'ENV_TOOLCHAIN_CACHE_UNSET' });
    assert.throws(() => pins.resolveCacheDirectory('relative/cache'), { code: 'ENV_TOOLCHAIN_CACHE_UNSET' });
    process.env[pins.CACHE_ENV] = CACHE;
    assert.equal(pins.resolveCacheDirectory(), CACHE);
    assert.equal(pins.readManifest(CACHE).schema, 'hseos.toolchain-cache.v1');
  } finally {
    if (saved === undefined) delete process.env[pins.CACHE_ENV];
    else process.env[pins.CACHE_ENV] = saved;
  }
  assert.ok(pins.PINS.pyright.license_markers.length > 0);
  assert.equal(new pins.ToolchainBlockedError('m').code, 'ENV_TOOLCHAIN_BLOCKED');
});

function swapArtifact(fixture, bytes) {
  fs.writeFileSync(fixture.artifact, bytes);
  const digest = sha(bytes);
  fixture.expected.fixture.sha256 = digest;
  const manifestPath = path.join(fixture.cache, 'toolchain-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.pins[0].sha256 = digest;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
}

/** A real tar whose member names are written verbatim (tar itself would strip them). */
function craftedTgz(names) {
  const script = `import io, sys, tarfile
buffer = io.BytesIO()
with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
    for name in sys.argv[1:]:
        data = b'Permission is hereby granted, free of charge'
        info = tarfile.TarInfo(name)
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))
sys.stdout.buffer.write(buffer.getvalue())`;
  return execFileSync('python3', ['-I', '-c', script, ...names]);
}

test('a real tar with a ../ member is refused before anything is extracted', () => {
  for (const names of [
    ['package/LICENSE', '../evil.txt'],
    ['package/LICENSE', 'package/../../evil.txt'],
    ['package/LICENSE', '/abs-evil.txt'],
  ]) {
    const fixture = fixtureCache();
    swapArtifact(fixture, craftedTgz(names));
    const destination = temp('hseos-lsp-dest-');
    assert.throws(
      () => pins.installToolchain({ cacheDirectory: fixture.cache, destination, names: ['fixture'], expected: fixture.expected }),
      {
        code: 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE',
      },
    );
    assert.deepEqual(fs.readdirSync(destination), [], 'nothing was extracted');
    assert.equal(fs.existsSync(path.join(path.dirname(destination), 'evil.txt')), false);
  }
  const clean = fixtureCache();
  swapArtifact(clean, craftedTgz(['package/LICENSE', 'package/index.js']));
  const ok = pins.installToolchain({
    cacheDirectory: clean.cache,
    destination: temp('hseos-lsp-dest-'),
    names: ['fixture'],
    expected: clean.expected,
  });
  assert.equal(ok.status, 'ready');
});

test('hash and extraction use the same bytes, and a re-install starts from a clean destination', () => {
  const fixture = fixtureCache();
  const destination = temp('hseos-lsp-dest-');
  pins.installToolchain({ cacheDirectory: fixture.cache, destination, names: ['fixture'], expected: fixture.expected });
  fs.writeFileSync(path.join(destination, 'fixture/package/stale.txt'), 'old');
  fs.writeFileSync(path.join(destination, 'fixture/package/LICENSE'), 'tampered');
  pins.installToolchain({ cacheDirectory: fixture.cache, destination, names: ['fixture'], expected: fixture.expected });
  assert.equal(fs.existsSync(path.join(destination, 'fixture/package/stale.txt')), false);
  assert.match(fs.readFileSync(path.join(destination, 'fixture/package/LICENSE'), 'utf8'), /Permission is hereby granted/);
  // Swapping the artifact after verification cannot change what is extracted: tar reads the verified bytes from stdin.
});

test('an extraction that fails keeps the previous install and is reported with a code, never as a raw error', () => {
  const fixture = fixtureCache();
  const destination = temp('hseos-lsp-dest-');
  const args = { cacheDirectory: fixture.cache, destination, names: ['fixture'], expected: fixture.expected };
  pins.installToolchain(args);
  const licence = path.join(destination, 'fixture/package/LICENSE');
  const before = fs.readFileSync(licence, 'utf8');
  // A destination that cannot be written makes the staging directory impossible: the failure happens before the swap.
  fs.chmodSync(destination, 0o500);
  try {
    if (process.getuid() !== 0) assert.throws(() => pins.installToolchain(args), { code: 'ENV_TOOLCHAIN_INSTALL_FAILED' });
  } finally {
    fs.chmodSync(destination, 0o700);
  }
  assert.equal(fs.readFileSync(licence, 'utf8'), before, 'the previous install is untouched');
  assert.deepEqual(fs.readdirSync(destination), ['fixture'], 'no staging directory is left behind');
});

// ---------------------------------------------------------------------------------------------------------------
// Scope resolution: component-by-component canonicalisation checked against the kernel as the oracle.
// ---------------------------------------------------------------------------------------------------------------

const SCOPE_MIRROR = 'file:///workspace';

test('a pending link seen through a symlinked parent is resolved against the REAL directory (reviewer case)', async () => {
  const spaces = workspace((root, main) => {
    fs.mkdirSync(path.join(root, 'top'));
    fs.symlinkSync('../../escape', path.join(root, 'top/dang.py'));
    fs.mkdirSync(path.join(root, 'p/q'), { recursive: true });
    fs.symlinkSync('../../top', path.join(root, 'p/q/linkdir'));
    fs.symlinkSync('../../top', path.join(root, 'p/q/viainner'));
    fs.symlinkSync('../../outside.ts', path.join(root, 'top/up.py'));
    fs.writeFileSync(path.join(main, 'escape'), '');
  });
  const references = { action: 'references', language: 'python', file: 'm.py', position: { line: 0, character: 5 } };
  const status = async (relative) =>
    scripted(
      spaces,
      hostOk({ action: 'references', locations: [{ uri: `${SCOPE_MIRROR}/${relative}`, range: loc('m.py').range }] }),
    ).service.run(references);
  for (const relative of ['top/dang.py', 'p/q/linkdir/dang.py', 'p/q/viainner/dang.py', 'p/q/linkdir/up.py']) {
    const output = await status(relative);
    assert.deepEqual([output.status, output.code], ['refused', 'ENV_LSP_OUT_OF_SCOPE'], relative);
  }
  // A `..` segment is refused outright, never collapsed into a path that looks in scope (and recorded in the ledger).
  for (const relative of [
    'p/q/linkdir/../../m.py',
    'p/q/linkdir/../../../../outside.ts',
    'top/../m.py',
    '%2e%2e/m.py',
    'p/%2E%2E/m.py',
    'p/..%2fm.py',
    'p/bad%zz.py',
  ]) {
    const { service, events } = scripted(
      spaces,
      hostOk({ action: 'references', locations: [{ uri: `${SCOPE_MIRROR}/${relative}`, range: loc('m.py').range }] }),
    );
    const output = await service.run(references);
    assert.deepEqual([output.status, output.code], ['refused', 'ENV_LSP_OUT_OF_SCOPE'], relative);
    assert.equal(events.at(-1).code, 'ENV_LSP_OUT_OF_SCOPE', relative);
  }
  // The requested file with a `..` segment is refused and recorded before any server runs.
  const { service, events, calls } = scripted(spaces, hostOk({ diagnostics: [] }));
  for (const file of ['p/q/linkdir/../../m.py', 'top/../m.py']) {
    assert.equal((await service.run({ action: 'diagnostics', language: 'python', file })).code, 'ENV_LSP_OUT_OF_SCOPE', file);
  }
  assert.equal(calls.length, 0);
  assert.equal(events.filter((event) => event.code === 'ENV_LSP_OUT_OF_SCOPE').length, 2);
});

function materialiseMatrix(root, main) {
  const abs = (...parts) => path.join(root, ...parts);
  fs.mkdirSync(path.join(main, 'outside'));
  fs.writeFileSync(path.join(main, 'outside/real.py'), '');
  fs.mkdirSync(abs('realdir'));
  fs.writeFileSync(abs('realdir/real.py'), '');
  fs.mkdirSync(abs('top'));
  const link = (name, target) => fs.symlinkSync(target, abs('top', name));
  link('d_in_abs', abs('realdir'));
  link('d_in_rel', '../realdir');
  link('d_out_abs', path.join(main, 'outside'));
  link('d_out_rel', '../../outside');
  link('f_in', '../realdir/real.py');
  link('f_out', '../../outside/real.py');
  link('pend_in_rel', '../realdir/none.py');
  link('pend_in_abs', abs('realdir/none.py'));
  link('pend_out_rel', '../../outside/none.py');
  link('pend_out_abs', path.join(main, 'outside/none.py'));
  link('pend_via_dir', 'd_out_rel/none.py');
  link('pend_via_dir_in', 'd_in_rel/none.py');
  link('pend_up', '../../escape');
  fs.mkdirSync(abs('p/q'), { recursive: true });
  fs.symlinkSync('../../top', abs('p/q/via'));
}

/** Kernel oracle: create the pending target for a moment, ask realpath, remove what was created. */
function oracle(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch (error) {
    assert.equal(error.code, 'ENOENT', candidate);
  }
  const createdDirectory = fs.mkdirSync(path.dirname(candidate), { recursive: true });
  fs.writeFileSync(candidate, '');
  const truth = fs.realpathSync(candidate);
  fs.rmSync(truth);
  if (createdDirectory) fs.rmSync(createdDirectory, { recursive: true });
  return truth;
}

test('generated matrix: resolveReal and the scope verdict equal the kernel for every link/parent combination', async () => {
  const spaces = workspace(materialiseMatrix);
  const base = fs.realpathSync(spaces.root);
  const names = ['d_in_abs', 'd_in_rel', 'd_out_abs', 'd_out_rel'];
  const relatives = [];
  for (const prefix of ['top', 'p/q/via']) {
    for (const name of names) relatives.push(`${prefix}/${name}/real.py`, `${prefix}/${name}/new.py`, `${prefix}/${name}/sub/dir/new.py`);
    for (const name of [
      'f_in',
      'f_out',
      'pend_in_rel',
      'pend_in_abs',
      'pend_out_rel',
      'pend_out_abs',
      'pend_via_dir',
      'pend_via_dir_in',
      'pend_up',
    ])
      relatives.push(`${prefix}/${name}`);
  }
  const references = { action: 'references', language: 'python', file: 'm.py', position: { line: 0, character: 5 } };
  let outside = 0;
  let inside = 0;
  for (const relative of relatives) {
    const ours = resolveRealOf(path.join(spaces.root, ...relative.split('/')));
    const truth = oracle(path.join(spaces.root, ...relative.split('/')));
    assert.equal(ours, truth, relative);
    // The scope verdict is compared with the kernel on every row.
    const expectedInside = truth === base || truth.startsWith(`${base}${path.sep}`);
    const output = await scripted(
      spaces,
      hostOk({ action: 'references', locations: [{ uri: `${SCOPE_MIRROR}/${relative}`, range: loc('m.py').range }] }),
    ).service.run(references);
    assert.equal(output.status === 'ok', expectedInside, `${relative} -> ${truth}`);
    if (expectedInside) {
      inside += 1;
      assert.equal(output.result.locations[0].path, path.relative(base, truth));
    } else {
      outside += 1;
      assert.equal(output.code, 'ENV_LSP_OUT_OF_SCOPE');
    }
  }
  assert.ok(inside >= 10 && outside >= 10, `matrix exercises both verdicts (${inside} in, ${outside} out)`);
  // Loops and chains over the hop limit are refused rather than followed.
  const loopRoot = temp('hseos-lsp-loop-');
  fs.symlinkSync('b', path.join(loopRoot, 'a'));
  fs.symlinkSync('a', path.join(loopRoot, 'b'));
  assert.throws(() => resolveRealOf(path.join(loopRoot, 'a')), { code: 'ENV_LSP_OUT_OF_SCOPE' });
  for (let index = 0; index < 45; index += 1) fs.symlinkSync(`h${index + 1}`, path.join(loopRoot, `h${index}`));
  assert.throws(() => resolveRealOf(path.join(loopRoot, 'h0')), { code: 'ENV_LSP_OUT_OF_SCOPE' });
  // An uninspectable component fails closed instead of being treated as missing.
  assert.notEqual(process.getuid(), 0, 'must run unprivileged');
  const locked = temp('hseos-lsp-locked-');
  fs.mkdirSync(path.join(locked, 'closed'));
  fs.chmodSync(path.join(locked, 'closed'), 0o000);
  try {
    assert.throws(() => resolveRealOf(path.join(locked, 'closed', 'x.py')), { code: 'ENV_LSP_OUT_OF_SCOPE' });
  } finally {
    fs.chmodSync(path.join(locked, 'closed'), 0o700);
  }
});

function resolveRealOf(candidate) {
  return environment.resolveReal(candidate);
}
