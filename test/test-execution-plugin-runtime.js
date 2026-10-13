'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const test = require('node:test');
const { mock } = test;
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const {
  admitExecutionPlugin,
  readExecutionPluginBundle,
  resolveExecutionPlugins,
  parseExecutionPluginManifest,
} = require('../tools/lib/execution-plugin-manifest');
const { executorOwner } = require('../packages/agent-isolation-attestation/executor');
const { executeExecutionPlugin, runExecutionPluginConformance } = require('../tools/cli/lib/execution-plugin-runtime');
const sha = (value) => createHash('sha256').update(value).digest('hex');

function fixture(
  t,
  source = 'module.exports = ({input}) => input;',
  {
    timeout_ms = 3000,
    max_output_bytes = 8192,
    conformance,
    manifestExtra = {},
    pids_max = 32,
    memory_max_bytes = 268_435_456,
    grantExtra = {},
  } = {},
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-plugin-runtime-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const diagnostic = conformance || 'module.exports = () => ({passed:true});';
  fs.writeFileSync(path.join(directory, 'entry.cjs'), source);
  fs.writeFileSync(path.join(directory, 'check.cjs'), diagnostic);
  const manifest = {
    schema_version: 1,
    id: 'external-plugin',
    version: '1.0.0',
    kind: 'tool',
    compatibility: { contract_version: 1, node_majors: [22, 24] },
    entrypoint: 'entry.cjs',
    files: { 'entry.cjs': sha(source), 'check.cjs': sha(diagnostic) },
    capabilities: [],
    limits: { timeout_ms, max_output_bytes, memory_max_bytes, pids_max },
    dependencies: [],
    conformance: ['check.cjs'],
    ...manifestExtra,
  };
  fs.writeFileSync(path.join(directory, 'execution.json'), JSON.stringify(manifest));
  const admission = admitExecutionPlugin(directory, {
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    manifest_sha256: sha(canonicalize(manifest)),
    node_major: Number(process.versions.node.split('.')[0]),
    contract_version: 1,
    allowed_capabilities: [],
    limits: manifest.limits,
    ...grantExtra,
  });
  return { directory, manifest, admission, request: { request_id: randomUUID(), method: 'invoke', input: { text: 'hello' } } };
}
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test('external code executes only from a read-only isolated snapshot with request-bound output', async (t) => {
  const f = fixture(
    t,
    `module.exports = ({input}) => {
    const fs=require('node:fs'); let denied=false;
    try { fs.writeFileSync('/workspace/runner.cjs','changed'); } catch(e) { denied=e.code==='EROFS'; }
    return {input,denied,env:Object.keys(process.env).sort(),cwd:process.cwd()};
  };`,
  );
  const result = await executeExecutionPlugin(f);
  assert.deepEqual(result.result, { input: { text: 'hello' }, denied: true, env: ['PATH', 'PWD'], cwd: '/workspace' });
  assert.equal(result.request_id, f.request.request_id);
  assert.equal(result.manifest_sha256, f.admission.manifest_sha256);
  assert.equal(result.isolation.descendants_terminated, true);
  assert.equal(result.isolation.limits.memory_bytes, 268_435_456);
});

test('untrusted imports cannot access the host workspace, source directory or arbitrary private file', async (t) => {
  const privateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-plugin-private-'));
  t.after(() => fs.rmSync(privateDirectory, { recursive: true, force: true }));
  const marker = path.join(privateDirectory, 'control');
  fs.writeFileSync(marker, 'protected');
  const f = fixture(
    t,
    `const fs=require('node:fs');
    module.exports=()=>({hidden:!fs.existsSync(${JSON.stringify(marker)}), host:!fs.existsSync(${JSON.stringify(__dirname)})});`,
  );
  assert.deepEqual((await executeExecutionPlugin(f)).result, { hidden: true, host: true });
  assert.equal(fs.readFileSync(marker, 'utf8'), 'protected');
});

test('network creation is refused inside an external plugin', async (t) => {
  const f = fixture(
    t,
    `module.exports=()=>new Promise(resolve=>{
    const socket=require('node:net').connect({host:'127.0.0.1',port:9});
    socket.on('error',e=>resolve({code:e.code}));
  });`,
  );
  assert.equal((await executeExecutionPlugin(f)).result.code, 'EPERM');
});

test('malformed output, forged identity, unsuccessful import and missing handlers fail closed', async (t) => {
  const cases = [
    ["console.log('not-json'); module.exports=()=>({});", 'PLUGIN_RESPONSE_INVALID'],
    [
      "process.stdout.write(JSON.stringify({schema_version:1,request_id:'00000000-0000-4000-8000-000000000000',plugin_id:'forged',manifest_sha256:'0'.repeat(64),result:{}}));process.exit(0);",
      'PLUGIN_RESPONSE_IDENTITY',
    ],
    ["throw Error('untrusted diagnostic');", 'PLUGIN_EXECUTION_FAILED'],
    ['module.exports={};', 'PLUGIN_EXECUTION_FAILED'],
    ['module.exports=()=>undefined;', 'PLUGIN_RESPONSE_INVALID'],
  ];
  for (const [source, code] of cases) await rejects(executeExecutionPlugin(fixture(t, source)), code);
});

test('timeout and output ceilings terminate plugin descendants', async (t) => {
  const slow = fixture(t, 'module.exports=()=>{while(true){}};', { timeout_ms: 200 });
  await rejects(executeExecutionPlugin(slow), 'PLUGIN_TIMEOUT');
  const flood = fixture(t, "module.exports=()=>{process.stdout.write('x'.repeat(100000));return {};};", { max_output_bytes: 256 });
  await rejects(executeExecutionPlugin(flood), 'PLUGIN_OUTPUT_LIMIT');
});

test('cancellation drains a plugin and a detached descendant; parent exit also drains descendants', async (t) => {
  const owner = executorOwner();
  const prefix = `hseos-executor-${owner.pid}-${owner.start_ticks}-`;
  const groups = () =>
    fs
      .readdirSync(owner.resource_parent)
      .filter((name) => name.startsWith(prefix))
      .sort();
  const before = groups();
  const write = fs.writeFileSync;
  let peak = 0;
  t.mock.method(fs, 'writeFileSync', (filename, ...args) => {
    if (String(filename).endsWith('/cgroup.kill')) {
      const members = fs.readFileSync(path.join(path.dirname(filename), 'cgroup.procs'), 'utf8').trim();
      peak = Math.max(peak, new Set(members ? members.split(/\s+/) : []).size);
    }
    return write(filename, ...args);
  });
  t.after(() => assert.deepEqual(groups(), before, 'no executor group or descendants remain'));

  const source = `const {spawn}=require('node:child_process');
    const child=spawn('/usr/bin/python3',['-I','-c','import time;time.sleep(60)'],{detached:true,stdio:'ignore'});child.unref();
    module.exports=()=>new Promise(resolve=>setTimeout(()=>resolve({}),60000));`;
  const f = fixture(t, source);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 200);
  try {
    await rejects(executeExecutionPlugin({ ...f, signal: controller.signal }), 'PLUGIN_CANCELLED');
  } finally {
    clearTimeout(timer);
  }
  const exited = fixture(t, source.replace('new Promise(resolve=>setTimeout(()=>resolve({}),60000))', '({ok:true})'));
  assert.equal((await executeExecutionPlugin(exited)).isolation.descendants_terminated, true);
  assert.ok(peak >= 3, `observed ${peak} processes; require executor, plugin and descendant`);
});

test('admission drift, malformed requests, expired deadlines and pre-cancellation reject before entrypoint effects', async (t) => {
  const f = fixture(t);
  await rejects(executeExecutionPlugin({ ...f, admission: { ...f.admission } }), 'PLUGIN_ADMISSION_REQUIRED');
  await rejects(executeExecutionPlugin({ ...f, request: { ...f.request, extra: true } }), 'PLUGIN_REQUEST_INVALID');
  await rejects(executeExecutionPlugin({ ...f, request: { ...f.request, input: 'x'.repeat(65_537) } }), 'PLUGIN_REQUEST_LIMIT');
  await rejects(executeExecutionPlugin({ ...f, deadline_at: Date.now() - 1 }), 'PLUGIN_DEADLINE_EXPIRED');
  await rejects(executeExecutionPlugin({ ...f, signal: AbortSignal.abort() }), 'PLUGIN_CANCELLED');
  fs.writeFileSync(path.join(f.directory, 'entry.cjs'), 'changed');
  await rejects(executeExecutionPlugin(f), 'PLUGIN_CONTENT_CHANGED');
});

test('plugin-supplied conformance is isolated and cannot claim host certification', async (t) => {
  const f = fixture(t);
  const result = await runExecutionPluginConformance(f);
  assert.equal(result.certified, false);
  assert.equal(result.kind, 'plugin-self-test');
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].isolation.descendants_terminated, true);
  const bad = fixture(t, undefined, { conformance: 'module.exports=()=>({passed:false});' });
  await rejects(runExecutionPluginConformance(bad), 'PLUGIN_CONFORMANCE_FAILED');
});

test('private snapshot remains pinned if the original plugin changes immediately before launch', async (t) => {
  const f = fixture(t, 'module.exports=()=>({version:"admitted"});');
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (filename, ...args) => {
    if (String(filename).endsWith('/admission.json')) write(path.join(f.directory, 'entry.cjs'), 'throw Error("changed");');
    return write(filename, ...args);
  });
  assert.deepEqual((await executeExecutionPlugin(f)).result, { version: 'admitted' });
  await rejects(executeExecutionPlugin(f), 'PLUGIN_CONTENT_CHANGED');
});

test('invalid signal fails before launch and drain uncertainty remains distinct from plugin failure', async (t) => {
  const f = fixture(t);
  await rejects(executeExecutionPlugin({ ...f, signal: { aborted: false } }), 'PLUGIN_REQUEST_INVALID');
  const write = fs.writeFileSync;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', (filename, ...args) => {
    if (!injected && String(filename).endsWith('/cgroup.kill')) {
      injected = true;
      const error = new Error('injected cleanup fault');
      error.code = 'EIO';
      throw error;
    }
    return write(filename, ...args);
  });
  // The executor propagates its conservative uncertainty and retries drain in finally.
  await rejects(executeExecutionPlugin(f), 'PLUGIN_TEARDOWN_UNCERTAIN');
  assert.equal(injected, true);
});

function readmit(f, dependencies = []) {
  fs.writeFileSync(path.join(f.directory, 'execution.json'), JSON.stringify(f.manifest));
  f.admission = admitExecutionPlugin(
    f.directory,
    {
      id: f.manifest.id,
      version: f.manifest.version,
      kind: f.manifest.kind,
      manifest_sha256: sha(canonicalize(f.manifest)),
      node_major: Number(process.versions.node.split('.')[0]),
      contract_version: 1,
      allowed_capabilities: [],
      limits: f.manifest.limits,
    },
    dependencies,
  );
  return f.admission;
}
const dependency = (admission) => ({
  id: admission.manifest.id,
  version: admission.manifest.version,
  manifest_sha256: admission.manifest_sha256,
});

test('execution snapshots pinned dependencies and refuses conflicting transitive versions', async (t) => {
  const child = fixture(t);
  child.manifest.id = 'child';
  readmit(child);
  const parent = fixture(t, "module.exports=({input})=>require('../child/entry.cjs')({input});");
  parent.manifest.dependencies = [dependency(child.admission)];
  readmit(parent, [child.admission]);
  assert.deepEqual((await executeExecutionPlugin(parent)).result, { text: 'hello' });
  const other = fixture(t);
  other.manifest.id = 'child';
  other.manifest.version = '2.0.0';
  readmit(other);
  const branch = fixture(t);
  branch.manifest.id = 'branch';
  branch.manifest.dependencies = [dependency(other.admission)];
  readmit(branch, [other.admission]);
  parent.manifest.dependencies.push(dependency(branch.admission));
  readmit(parent, [child.admission, branch.admission]);
  await rejects(executeExecutionPlugin(parent), 'PLUGIN_SELECTION_CONFLICT');
});

test('shared dependency is materialized once and ESM entrypoints remain isolated', async (t) => {
  const child = fixture(t);
  child.manifest.id = 'child';
  readmit(child);
  const branch = fixture(t);
  branch.manifest.id = 'branch';
  branch.manifest.dependencies = [dependency(child.admission)];
  readmit(branch, [child.admission]);
  const parent = fixture(t);
  parent.manifest.dependencies = [dependency(child.admission), dependency(branch.admission)];
  const source = 'export default ({input})=>input;';
  parent.manifest.entrypoint = 'entry.mjs';
  delete parent.manifest.files['entry.cjs'];
  parent.manifest.files['entry.mjs'] = sha(source);
  fs.writeFileSync(path.join(parent.directory, 'entry.mjs'), source);
  readmit(parent, [child.admission, branch.admission]);
  assert.deepEqual((await executeExecutionPlugin(parent)).result, { text: 'hello' });
});

test('isolation setup failure is distinct from an attempted execution with uncertain teardown', async (t) => {
  const f = fixture(t);
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (filename, ...args) => {
    if (String(filename).endsWith('/admission.json')) throw new Error('injected before launch');
    return write(filename, ...args);
  });
  await rejects(executeExecutionPlugin(f), 'PLUGIN_ISOLATION_FAILED');
});

const PNG_HEADER = '[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]';
const ARTIFACTS = {
  max_files: 2,
  max_file_bytes: 4096,
  max_total_bytes: 8192,
  media_types: ['image/png', 'text/plain'],
  shm_bytes: 4_194_304,
};

test('default plugins stay P0 with peaks reported, and a wider profile needs both a manifest reference and a grant', async (t) => {
  const result = await executeExecutionPlugin(fixture(t));
  assert.equal(result.isolation.profile, 'P0');
  assert.ok(result.isolation.pids_peak >= 2 && result.isolation.memory_peak_bytes > 0);
  assert.equal(result.isolation.limits.processes, 32);
  assert.equal(Object.hasOwn(result, 'artifacts'), false);
  const wanted = { manifestExtra: { isolation_profile: 'P1' } };
  assert.throws(
    () => fixture(t, undefined, wanted),
    (error) => error.code === 'PLUGIN_PROFILE_DENIED',
  );
  assert.throws(
    () => fixture(t, undefined, { ...wanted, grantExtra: { isolation_profile: 'P0' } }),
    (error) => error.code === 'PLUGIN_PROFILE_DENIED',
  );
  assert.throws(
    () => fixture(t, undefined, { manifestExtra: { isolation_profile: 'P7' } }),
    (error) => error.code === 'PLUGIN_MANIFEST_INVALID',
  );
  assert.doesNotThrow(() => fixture(t, undefined, { ...wanted, grantExtra: { isolation_profile: 'P2' } }));
});

test('a P1 plugin reaches loopback only; the grant, not the plugin, chose the profile', async (t) => {
  const source = `const net=require('node:net');
    module.exports=async()=>{
      const server=net.createServer(s=>s.end('pong')); await new Promise(r=>server.listen(0,'127.0.0.1',r));
      const reply=await new Promise((resolve)=>{ const c=net.connect(server.address().port,'127.0.0.1'); let d=''; c.on('data',x=>d+=x); c.on('close',()=>resolve(d)); });
      server.close();
      const external=await new Promise((resolve)=>{ const c=net.connect({host:'1.1.1.1',port:443}); c.on('error',e=>resolve(e.code)); c.on('connect',()=>resolve('reachable')); });
      return { reply, external };
    };`;
  const f = fixture(t, source, { manifestExtra: { isolation_profile: 'P1' }, grantExtra: { isolation_profile: 'P1' }, timeout_ms: 8000 });
  const result = await executeExecutionPlugin(f);
  assert.deepEqual(result.result, { reply: 'pong', external: 'ENETUNREACH' });
  assert.equal(result.isolation.profile, 'P1');
  await rejects(executeExecutionPlugin({ ...f, broker_socket: '/tmp/none.sock' }), 'PLUGIN_PROFILE_INVALID');
});

test('a P2 plugin needs a controller-supplied broker socket and a P0 plugin cannot be given one', async (t) => {
  const p2 = fixture(t, undefined, { manifestExtra: { isolation_profile: 'P2' }, grantExtra: { isolation_profile: 'P2' } });
  await rejects(executeExecutionPlugin(p2), 'PLUGIN_PROFILE_INVALID');
  await rejects(executeExecutionPlugin({ ...fixture(t), broker_socket: '/tmp/none.sock' }), 'PLUGIN_PROFILE_INVALID');
  await rejects(executeExecutionPlugin({ ...p2, broker_socket: '/tmp/definitely-missing.sock' }), 'PLUGIN_ISOLATION_FAILED');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-plugin-broker-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const socketPath = path.join(directory, 'broker.sock');
  const server = require('node:net').createServer((socket) => socket.end('broker-ok'));
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const source = `const net=require('node:net');
    module.exports=()=>new Promise((resolve)=>{ const c=net.connect('/run/broker.sock'); let d=''; c.on('data',x=>d+=x); c.on('close',()=>resolve(d)); c.on('error',e=>resolve(e.code)); });`;
  const f = fixture(t, source, { manifestExtra: { isolation_profile: 'P2' }, grantExtra: { isolation_profile: 'P2' } });
  assert.equal((await executeExecutionPlugin({ ...f, broker_socket: socketPath })).result, 'broker-ok');
});

test('artifacts are promoted only after the controller recomputes digest, size and signature', async (t) => {
  const writer = (body) => `const fs=require('node:fs'); const crypto=require('node:crypto');
    module.exports=({artifacts})=>{ ${body} };`;
  const good = writer(`const png=Buffer.concat([Buffer.from(${PNG_HEADER}),Buffer.from('frame')]);
    fs.writeFileSync('/artifacts/frame.png',png);
    artifacts.declare([{path:'/artifacts/frame.png',media_type:'image/png',bytes:png.length,sha256:crypto.createHash('sha256').update(png).digest('hex')}]);
    return {shm:fs.statfsSync('/dev/shm').blocks*fs.statfsSync('/dev/shm').bsize};`);
  const options = { manifestExtra: { artifacts: ARTIFACTS }, grantExtra: { artifacts: ARTIFACTS } };
  const result = await executeExecutionPlugin(fixture(t, good, options));
  assert.equal(result.result.shm, 4_194_304);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0].media_type, 'image/png');
  assert.equal(result.artifacts[0].bytes, 13);

  const liar = writer(`fs.writeFileSync('/artifacts/frame.png','plain text');
    artifacts.declare([{path:'/artifacts/frame.png',media_type:'image/png',bytes:10,sha256:'0'.repeat(64)}]); return {};`);
  await rejects(executeExecutionPlugin(fixture(t, liar, options)), 'PLUGIN_ARTIFACTS_REJECTED');
  const undeclared = writer(`fs.writeFileSync('/artifacts/hidden.txt','x'); return {};`);
  await rejects(executeExecutionPlugin(fixture(t, undeclared, options)), 'PLUGIN_ARTIFACTS_REJECTED');
  const escaped = writer(
    `artifacts.declare([{path:'/artifacts/../workspace/request.json',media_type:'text/plain',bytes:1,sha256:'0'.repeat(64)}]); return {};`,
  );
  await rejects(executeExecutionPlugin(fixture(t, escaped, options)), 'PLUGIN_ARTIFACTS_REJECTED');
  const unused = await executeExecutionPlugin(fixture(t, writer('return {declared:typeof artifacts};'), options));
  assert.deepEqual(unused.artifacts, []);
});

test('artifact grants cannot be exceeded, and a plugin without them has no channel or declaration', async (t) => {
  const reasons = [
    { ...ARTIFACTS, max_files: 3 },
    { ...ARTIFACTS, max_file_bytes: 8192 },
    { ...ARTIFACTS, max_total_bytes: 16_384 },
    { ...ARTIFACTS, shm_bytes: 8_388_608 },
    { ...ARTIFACTS, media_types: ['image/png', 'application/pdf'] },
  ];
  for (const requested of reasons) {
    assert.throws(
      () => fixture(t, undefined, { manifestExtra: { artifacts: requested }, grantExtra: { artifacts: ARTIFACTS } }),
      (error) => error.code === 'PLUGIN_ARTIFACTS_DENIED',
    );
  }
  assert.throws(
    () => fixture(t, undefined, { manifestExtra: { artifacts: ARTIFACTS } }),
    (error) => error.code === 'PLUGIN_ARTIFACTS_DENIED',
  );
  assert.throws(
    () =>
      fixture(t, undefined, { manifestExtra: { artifacts: { ...ARTIFACTS, max_file_bytes: 9000 } }, grantExtra: { artifacts: ARTIFACTS } }),
    (error) => error.code === 'PLUGIN_MANIFEST_INVALID',
  );
  const none = fixture(t, 'module.exports=({artifacts})=>({channel:typeof artifacts});');
  assert.equal((await executeExecutionPlugin(none)).result.channel, 'undefined');
  const forged = fixture(
    t,
    "process.stdout.write(JSON.stringify({schema_version:1,request_id:process.env.NOPE||'x',plugin_id:'external-plugin',manifest_sha256:'0'.repeat(64),result:{},artifacts:[]}));process.exit(0);",
  );
  await rejects(executeExecutionPlugin(forged), 'PLUGIN_RESPONSE_INVALID');
});

test('declared limits are applied per call: the process and memory ceilings come from the manifest', async (t) => {
  const source = `const cp=require('node:child_process'); module.exports=()=>{ let n=0; for(let i=0;i<100;i++){ const c=cp.spawn('/usr/bin/sleep',['3'],{stdio:'ignore'}); c.on('error',()=>{}); if(c.pid) n++; } return {n}; };`;
  const narrow = await executeExecutionPlugin(fixture(t, source, { timeout_ms: 8000 }));
  assert.ok(narrow.result.n > 0 && narrow.result.n < 32, `spawned ${narrow.result.n}`);
  assert.equal(narrow.isolation.limits.processes, 32);
  const wide = await executeExecutionPlugin(fixture(t, source, { timeout_ms: 8000, pids_max: 128, memory_max_bytes: 536_870_912 }));
  assert.ok(wide.result.n > 32 && wide.result.n <= 100, `spawned ${wide.result.n}`);
  assert.equal(wide.isolation.limits.processes, 128);
  assert.equal(wide.isolation.limits.memory_bytes, 536_870_912);
  assert.ok(wide.isolation.pids_peak > 32 && wide.isolation.pids_peak <= 128);
});

test('a plugin cannot request mounts: the field is not part of the manifest or the grant', (t) => {
  const mounts = [{ source: '/etc', target: '/opt/hseos/etc' }];
  assert.throws(
    () => fixture(t, undefined, { manifestExtra: { readonly_mounts: mounts } }),
    (error) => error.code === 'PLUGIN_MANIFEST_INVALID',
  );
  assert.throws(
    () => fixture(t, undefined, { grantExtra: { readonly_mounts: mounts } }),
    (error) => error.code === 'PLUGIN_POLICY_INVALID',
  );
});

test('a plugin without a channel cannot return artifacts, even with a correct identity envelope', async (t) => {
  const source = `const fs=require('node:fs'); const r=JSON.parse(fs.readFileSync('/workspace/request.json','utf8'));
    process.stdout.write(JSON.stringify({schema_version:1,request_id:r.request_id,plugin_id:r.plugin_id,manifest_sha256:r.manifest_sha256,result:{},artifacts:[]}));
    process.exit(0);`;
  await rejects(executeExecutionPlugin(fixture(t, source)), 'PLUGIN_RESPONSE_INVALID');
});

const listing = (directory, prefix) => fs.readdirSync(directory).filter((name) => name.startsWith(prefix));

test('unreadable directories left by a plugin are removed: no tmpfs or workspace leak and the right diagnosis', async (t) => {
  const options = { manifestExtra: { artifacts: ARTIFACTS }, grantExtra: { artifacts: ARTIFACTS } };
  const before = [listing('/dev/shm', 'hseos-artifacts-'), listing(os.tmpdir(), 'hseos-plugin-execution-')];
  const nested =
    "module.exports=()=>{const fs=require('node:fs'); fs.mkdirSync('/artifacts/d/e',{recursive:true}); fs.writeFileSync('/artifacts/d/e/f','x'); fs.chmodSync('/artifacts/d/e',0); fs.chmodSync('/artifacts/d',0); return {};};";
  await rejects(executeExecutionPlugin(fixture(t, nested, options)), 'PLUGIN_ARTIFACTS_REJECTED');
  const root = "module.exports=()=>{require('node:fs').chmodSync('/artifacts',0); return {};};";
  await rejects(executeExecutionPlugin(fixture(t, root, options)), 'PLUGIN_ARTIFACTS_REJECTED');
  assert.deepEqual([listing('/dev/shm', 'hseos-artifacts-'), listing(os.tmpdir(), 'hseos-plugin-execution-')], before);
});

test('a cleanup fault is recorded beside the result and never replaces it', async (t) => {
  const options = { manifestExtra: { artifacts: ARTIFACTS }, grantExtra: { artifacts: ARTIFACTS } };
  const before = listing('/dev/shm', 'hseos-artifacts-');
  const original = fs.rmSync;
  mock.method(fs, 'rmSync', (target, ...rest) => {
    if (String(target).includes('hseos-artifacts-') || String(target).includes('hseos-plugin-execution-')) {
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    }
    return original(target, ...rest);
  });
  let result;
  try {
    result = await executeExecutionPlugin(fixture(t, 'module.exports=()=>({kept:true});', options));
  } finally {
    mock.restoreAll();
  }
  assert.deepEqual(result.result, { kept: true });
  assert.deepEqual({ ...result.isolation.cleanup }, { artifacts: 'failed', workspace: 'failed' });
  for (const name of listing('/dev/shm', 'hseos-artifacts-').filter((entry) => !before.includes(entry)))
    original(path.join('/dev/shm', name), { recursive: true, force: true });
  for (const name of listing(os.tmpdir(), 'hseos-plugin-execution-'))
    original(path.join(os.tmpdir(), name), { recursive: true, force: true });
});

test('execution plugin selection resolves dependencies in order and refuses every inconsistent catalog', (t) => {
  const f = fixture(t);
  const child = { ...f.manifest, id: 'child-plugin' };
  const parent = { ...f.manifest, dependencies: [{ id: child.id, version: child.version, manifest_sha256: sha(canonicalize(child)) }] };
  const entry = (value) => ({ manifest: value, manifest_sha256: sha(canonicalize(value)) });
  const catalog = [entry(parent), entry(child)];
  assert.deepEqual(
    resolveExecutionPlugins(catalog, [parent.id, child.id]).map((item) => item.manifest.id),
    [child.id, parent.id],
  );
  assert.deepEqual(resolveExecutionPlugins(catalog, []), []);
  const code = (action, expected) => assert.throws(action, (error) => error.code === expected, expected);
  code(() => resolveExecutionPlugins(catalog, ['missing']), 'PLUGIN_DEPENDENCY_MISSING');
  code(() => resolveExecutionPlugins(catalog, [child.id, child.id]), 'PLUGIN_SELECTION_INVALID');
  code(() => resolveExecutionPlugins('x', []), 'PLUGIN_SELECTION_INVALID');
  code(() => resolveExecutionPlugins([entry(parent)], [parent.id]), 'PLUGIN_DEPENDENCY_MISMATCH');
  code(() => resolveExecutionPlugins([entry(parent), entry({ ...child, version: '2.0.0' })], [parent.id]), 'PLUGIN_DEPENDENCY_MISMATCH');
  code(() => resolveExecutionPlugins([entry(child), entry(child)], []), 'PLUGIN_CATALOG_INVALID');
  code(() => resolveExecutionPlugins([{ ...entry(child), manifest_sha256: sha('wrong') }], []), 'PLUGIN_CATALOG_INVALID');
  const cyclic = { ...f.manifest, id: 'cycle-a' };
  const partner = {
    ...f.manifest,
    id: 'cycle-b',
    dependencies: [{ id: 'cycle-a', version: '1.0.0', manifest_sha256: sha(canonicalize(cyclic)) }],
  };
  cyclic.dependencies = [{ id: 'cycle-b', version: '1.0.0', manifest_sha256: sha(canonicalize(partner)) }];
  code(() => resolveExecutionPlugins([entry(cyclic), entry(partner)], ['cycle-a']), 'PLUGIN_DEPENDENCY_MISMATCH');
});

test('bundles and manifests with unsafe or malformed content are rejected before admission', (t) => {
  const f = fixture(t);
  const code = (action, expected) => assert.throws(action, (error) => error.code === expected, expected);
  code(() => readExecutionPluginBundle(path.join(f.directory, 'missing')), 'PLUGIN_BUNDLE_INVALID');
  code(() => parseExecutionPluginManifest({ ...f.manifest, files: {} }), 'PLUGIN_FILES_INVALID');
  code(() => parseExecutionPluginManifest({ ...f.manifest, entrypoint: 'check.txt' }), 'PLUGIN_ENTRYPOINT_INVALID');
  code(() => parseExecutionPluginManifest({ ...f.manifest, conformance: ['absent.cjs'] }), 'PLUGIN_CONFORMANCE_INVALID');
  code(
    () => parseExecutionPluginManifest({ ...f.manifest, files: { ...f.manifest.files, 'entry.cjs/inner.cjs': 'a'.repeat(64) } }),
    'PLUGIN_FILES_INVALID',
  );
  code(
    () =>
      parseExecutionPluginManifest({
        ...f.manifest,
        dependencies: [{ id: f.manifest.id, version: '1.0.0', manifest_sha256: 'a'.repeat(64) }],
      }),
    'PLUGIN_DEPENDENCY_INVALID',
  );
  code(() => parseExecutionPluginManifest({ ...f.manifest, extra: true }), 'PLUGIN_MANIFEST_INVALID');
  const link = path.join(f.directory, 'via-link');
  fs.symlinkSync(f.directory, link);
  code(() => readExecutionPluginBundle(link), 'PLUGIN_PATH_UNSAFE');
  fs.appendFileSync(path.join(f.directory, 'entry.cjs'), ' ');
  code(() => readExecutionPluginBundle(f.directory), 'PLUGIN_CONTENT_CHANGED');
});

test('the cleanup outcome travels with a rejection as well as with a result', async (t) => {
  const options = { manifestExtra: { artifacts: ARTIFACTS }, grantExtra: { artifacts: ARTIFACTS } };
  const hidden =
    "module.exports=()=>{require('node:fs').mkdirSync('/artifacts/d'); require('node:fs').chmodSync('/artifacts/d',0); return {};};";
  const rejected = await executeExecutionPlugin(fixture(t, hidden, options)).catch((error) => error);
  assert.equal(rejected.code, 'PLUGIN_ARTIFACTS_REJECTED');
  assert.deepEqual({ ...rejected.cleanup }, { artifacts: 'removed', workspace: 'removed' });
  const plain = await executeExecutionPlugin(fixture(t, 'throw Error("x");')).catch((error) => error);
  assert.equal(plain.code, 'PLUGIN_EXECUTION_FAILED');
  assert.deepEqual({ ...plain.cleanup }, { artifacts: null, workspace: 'removed' });

  const original = fs.rmSync;
  const before = [listing('/dev/shm', 'hseos-artifacts-'), listing(os.tmpdir(), 'hseos-plugin-execution-')];
  mock.method(fs, 'rmSync', (target, ...rest) => {
    if (String(target).includes('hseos-artifacts-') || String(target).includes('hseos-plugin-execution-'))
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return original(target, ...rest);
  });
  let failed;
  try {
    failed = await executeExecutionPlugin(fixture(t, hidden, options)).catch((error) => error);
  } finally {
    mock.restoreAll();
  }
  assert.equal(failed.code, 'PLUGIN_ARTIFACTS_REJECTED');
  assert.deepEqual({ ...failed.cleanup }, { artifacts: 'failed', workspace: 'failed' });
  for (const name of listing('/dev/shm', 'hseos-artifacts-').filter((entry) => !before[0].includes(entry))) {
    const target = path.join('/dev/shm', name);
    require('node:child_process').execFileSync('/usr/bin/chmod', ['-R', 'u+rwx', target]);
    original(target, { recursive: true, force: true });
  }
  for (const name of listing(os.tmpdir(), 'hseos-plugin-execution-').filter((entry) => !before[1].includes(entry))) {
    original(path.join(os.tmpdir(), name), { recursive: true, force: true });
  }
});
