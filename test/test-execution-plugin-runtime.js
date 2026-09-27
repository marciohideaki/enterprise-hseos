'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const test = require('node:test');
const { canonicalize } = require('../packages/managed-governance-contracts/canonical-json');
const { admitExecutionPlugin } = require('../tools/lib/execution-plugin-manifest');
const { executorOwner } = require('../packages/agent-isolation-attestation/executor');
const { executeExecutionPlugin, runExecutionPluginConformance } = require('../tools/cli/lib/execution-plugin-runtime');
const sha = (value) => createHash('sha256').update(value).digest('hex');

function fixture(t, source = 'module.exports = ({input}) => input;', { timeout_ms = 3000, max_output_bytes = 8192, conformance } = {}) {
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
    limits: { timeout_ms, max_output_bytes, memory_max_bytes: 268_435_456, pids_max: 32 },
    dependencies: [],
    conformance: ['check.cjs'],
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
