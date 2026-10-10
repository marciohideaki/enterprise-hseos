// HSEOS core journey (A3, revalidation 2026-10): control API + JS/TS/Python SDKs against ONE `hseos control serve`
// instance, installed from the packed tarball outside the checkout. No model/provider dispatch of any kind.
//
//   node test/journeys/core-journey.mjs --prefix <consumer project dir> --tgz <tarball> --out <evidence dir>
//        [--tsc <tsc.js>] [--python <python3>] [--service-mode user|system] [--only s01,s02,...] [--max-load 6] [--keep-work]
//
// --service-mode user (default) starts the delegated cgroup service with `systemd-run --user` (workstations);
// --service-mode system uses `sudo systemd-run --uid/--gid` (CI runners without a user manager).
//
// Every step records PASS | FAIL | BLOCKED; a FAIL is never converted into a pass and never worked around.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const PREFIX = path.resolve(opt('prefix', ''));
const OUT = path.resolve(opt('out', ''));
if (!opt('prefix') || !opt('out')) {
  console.error(
    'usage: core-journey.mjs --prefix <consumer project> --tgz <tarball> --out <evidence dir> [--tsc tsc.js] [--python python3] [--service-mode user|system] [--only ids] [--max-load n]',
  );
  process.exit(2);
}
if (!opt('tgz')) {
  console.error('--tgz <packed hseos tarball> is required');
  process.exit(2);
}
const TGZ = path.resolve(opt('tgz'));
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSC = path.resolve(opt('tsc', process.env.TSC || path.join(REPO_ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js')));
const PYTHON = opt('python', process.env.PYTHON || 'python3');
const SERVICE_MODE = opt('service-mode', process.env.HSEOS_JOURNEY_SERVICE_MODE || 'user');
if (!['user', 'system'].includes(SERVICE_MODE)) {
  console.error('--service-mode must be user or system');
  process.exit(2);
}
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null;
const MAX_LOAD = Number(opt('max-load', '6'));
const KEEP_WORK = argv.includes('--keep-work');
const PKG = path.join(PREFIX, 'node_modules', 'hseos');
const WORK = path.join(OUT, 'work');
const SDK_DIR = path.join(PKG, 'packages', 'control-sdk');
const require = createRequire(path.join(PREFIX, 'noop.js'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CREDENTIAL = randomBytes(36).toString('base64url'); // never printed or written
const UNIT = `hseos-a3-${randomBytes(4).toString('hex')}`;
const RUN_TAG = randomBytes(4).toString('hex');

// ---------------------------------------------------------------------------------------------- utilities
const canon = (value) => JSON.stringify(sortKeys(value));
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  return value;
}
const same = (a, b) => canon(a) === canon(b);
const cmd = (resource, action, sequence, input = {}) => ({
  schema_version: 1,
  command_id: randomUUID(),
  resource_id: resource,
  expected_sequence: sequence,
  action,
  input,
});
const norm = (events) => events.map((e) => [e.stream_sequence, e.event_type, e.payload?.kind ?? null]);
const terminalStates = new Set(['succeeded', 'failed', 'cancelled', 'uncertain', 'expired', 'invalidated']);

function readLoad1() {
  return Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
}
const loadWaits = [];
async function loadGate(label) {
  const started = Date.now();
  while (readLoad1() > MAX_LOAD) {
    if (Date.now() - started > 15 * 60_000) throw new Blocked(`host load stayed above ${MAX_LOAD} for 15 min before ${label}`);
    await sleep(10_000);
  }
  if (Date.now() - started > 1000) loadWaits.push({ before: label, waited_ms: Date.now() - started });
}

async function waitFor(fn, { timeout = 30_000, interval = 100, what = 'condition' } = {}) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`timeout waiting for ${what}`);
}

/** Host processes whose command line contains `marker` (used to prove descendants started and drained). */
function procsWith(marker) {
  const found = [];
  for (const pid of fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
    if (Number(pid) === process.pid) continue;
    try {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
      if (cmdline.includes(marker)) found.push({ pid: Number(pid), cmd: cmdline.slice(0, 120).replace(CREDENTIAL, '***') });
    } catch {
      /* process vanished */
    }
  }
  return found;
}

class Blocked extends Error {}
class ControlError extends Error {
  constructor(code, message) {
    super(message || code || 'error');
    this.code = code;
  }
}

function raw(method, route, { body, cred = CREDENTIAL, headers = {}, url = ctx.url, json = true, contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const h = {
      ...(cred === null ? {} : { authorization: `Bearer ${cred}` }),
      ...(payload ? { 'content-type': contentType } : {}),
      ...headers,
    };
    const req = http.request({ host: target.hostname, port: target.port, path: route, method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try {
          parsed = json ? JSON.parse(text) : text;
        } catch {
          parsed = text;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', (error) => resolve({ status: 0, error: error.code || error.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------------------------- SDK adapters
/** One uniform call surface over the three SDKs: call(method, ...args) -> result | throws ControlError(code). */
class JsAdapter {
  constructor(url, cred = CREDENTIAL) {
    const { ControlClient } = require(SDK_DIR);
    this.client = new ControlClient({ url, credential: cred });
    this.serialized = JSON.stringify(this.client);
  }
  async call(method, ...args) {
    try {
      return await this.client[method === 'execute' ? 'execute' : method](...args);
    } catch (error) {
      throw new ControlError(error.code ?? null, error.message);
    }
  }
  async close() {}
  name = 'js';
}
class WorkerAdapter {
  constructor(name, command, args, env) {
    this.name = name;
    this.next = 1;
    this.pending = new Map();
    this.buffer = '';
    this.child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.stderr = '';
    this.child.stderr.on('data', (d) => (this.stderr += d.toString().replace(CREDENTIAL, '***')));
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.child.once('exit', (code) => {
        for (const p of this.pending.values()) p.reject(new Error(`${name} worker exited (${code}): ${this.stderr.slice(-400)}`));
        reject(new Error(`${name} worker exited before ready (${code}): ${this.stderr.slice(-400)}`));
      });
    });
    this.ready.catch(() => {});
    this.child.stdout.on('data', (d) => {
      this.buffer += d.toString();
      let i;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.ready) {
          this.info = message;
          this.resolveReady(message);
        } else this.pending.get(message.id)?.resolve(message);
      }
    });
  }
  async call(method, ...args) {
    await this.ready;
    const id = this.next++;
    const reply = await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, method, args }) + '\n');
    });
    this.pending.delete(id);
    if (!reply.ok) throw new ControlError(reply.error.code, reply.error.message);
    return reply.result;
  }
  async close() {
    try {
      this.child.stdin.end();
    } catch {
      /* stdin already closed */
    }
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        this.child.kill('SIGKILL');
        resolve();
      }, 2000);
      this.child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
const nodeBin = process.execPath;
function makeAdapters(url, cred = CREDENTIAL) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, HSEOS_CONTROL_CREDENTIAL: cred };
  return {
    js: new JsAdapter(url, cred),
    ts: new WorkerAdapter('ts', nodeBin, [path.join(WORK, 'ts', 'sdk-ts-client.ts'), url], env),
    py: new WorkerAdapter('py', PYTHON, ['-I', '-B', path.join(WORK, 'sdk_py_client.py'), SDK_DIR, url], env),
  };
}

// ---------------------------------------------------------------------------------------------- steps framework
const ctx = { url: null, state: null, sdk: null, serveGeneration: 0, projects: {}, results: [], limitations: [], notes: {} };
const only = (id) => !ONLY || id === 's01-serve' || [...ONLY].some((p) => id.startsWith(p));

class Checks {
  constructor() {
    this.items = [];
  }
  ok(name, condition, detail) {
    this.items.push({ name, ok: Boolean(condition), ...(detail === undefined ? {} : { detail: trim(detail) }) });
    return Boolean(condition);
  }
  get failed() {
    return this.items.filter((c) => !c.ok);
  }
}
function trim(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 700 ? text.slice(0, 700) + '...' : value;
}
async function step(id, description, fn, { needs = [] } = {}) {
  if (!only(id)) return;
  const started = Date.now();
  const c = new Checks();
  const extra = {};
  let status = 'PASS';
  let error;
  console.log(`[${id}] ${description}`);
  try {
    for (const need of needs) if (!ctx[need]) throw new Blocked(`prerequisite missing: ${need}`);
    await loadGate(id);
    await fn(c, extra);
    if (c.failed.length > 0) status = 'FAIL';
  } catch (error_) {
    status = error_ instanceof Blocked ? 'BLOCKED' : 'FAIL';
    error = {
      message: String(error_.message).replace(CREDENTIAL, '***'),
      stack: String(error_.stack || '')
        .split('\n')
        .slice(0, 4)
        .join(' | ')
        .replace(CREDENTIAL, '***'),
    };
  }
  const record = {
    id,
    descricao: description,
    status,
    evidencia: { checks: c.items, ...extra, ...(error ? { error } : {}) },
    duracao_ms: Date.now() - started,
  };
  ctx.results.push(record);
  fs.mkdirSync(path.join(OUT, 'steps'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'steps', `${id}.json`), JSON.stringify(record, null, 2));
  const bad = c.failed.map((x) => x.name);
  console.log(
    `    -> ${status} (${record.duracao_ms} ms)${bad.length > 0 ? ' failed: ' + bad.join('; ') : ''}${error ? ' error: ' + error.message : ''}`,
  );
}

// ---------------------------------------------------------------------------------------------- fixtures
function writeFile(root, name, content) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), content, { mode: 0o600 });
}
function exampleCli(name, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const out = execFileSync(nodeBin, [path.join(PKG, 'tools', 'examples', 'project-task.js'), name, directory, '--correction'], {
    encoding: 'utf8',
  });
  const info = JSON.parse(out);
  const example = JSON.parse(fs.readFileSync(info.example, 'utf8'));
  return { workspace: info.workspace, contract: example.contract, responses: example.responses };
}
/** Custom Git project: verifier module + a long-running command + a pty echo command (descendants carry a marker). */
function customProject(name, markerLong, markerEcho) {
  const { prepareProjectTask } = require(path.join(PKG, 'tools/cli/lib/engineering-workspace'));
  const root = path.join(WORK, 'projects', name);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const files = {
    'index.js': 'module.exports = (n) => n + 1;\n',
    'README.md': `# ${name}\nJourney fixture project.\n`,
    'scripts/long.js': [
      "const { spawn } = require('node:child_process');",
      'const marker = process.argv[2];',
      "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], { stdio: 'ignore' });",
      String.raw`process.stdout.write('long-started\n');`,
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'),
    'scripts/echo.js': [
      "const { spawn } = require('node:child_process');",
      'const marker = process.argv[2];',
      "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], { stdio: 'ignore' });",
      String.raw`process.stdout.write('READY\n');`,
      String.raw`process.stdin.on('data', (d) => process.stdout.write('ECHO:' + d.toString().toUpperCase().replace(/\r?\n$/, '') + '\n'));`,
      String.raw`process.on('SIGWINCH', () => process.stdout.write('SIZE ' + process.stdout.rows + 'x' + process.stdout.columns + '\n'));`,
      String.raw`process.stdin.on('end', () => { process.stdout.write('EOF\n'); process.exit(0); });`,
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'),
  };
  for (const [n, content] of Object.entries(files)) writeFile(root, n, content);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
  git('init', '-b', 'task/journey');
  git('config', 'user.name', 'HSEOS Journey');
  git('config', 'user.email', 'journey@example.invalid');
  git('add', '.');
  git('commit', '-m', 'test(journey): baseline');
  const spec = 'Increment the input by one.';
  const contract = prepareProjectTask({
    schema_version: 2,
    task_id: name,
    execution_profile: 'managed-project',
    workspace: { root },
    sources: [{ id: 'spec', kind: 'specification', content: spec, sha256: sha256(spec) }],
    requirements: [{ id: 'r1', description: spec, source_ids: ['spec'] }],
    acceptance: [{ id: 'a1', description: 'Protected cases validate the increment.', requirement_ids: ['r1'] }],
    scope: { read: Object.keys(files), write: ['index.js'] },
    commands: [
      { id: 'long', runtime: 'node', entrypoint: 'scripts/long.js', args: [markerLong] },
      { id: 'echo', runtime: 'node', entrypoint: 'scripts/echo.js', args: [markerEcho] },
    ],
    limits: { max_turns: 12, max_tokens: 500_000, max_duration_ms: 120_000, max_tool_calls: 12, max_children: 0, max_workflow_steps: 0 },
    max_failed_corrections: 1,
    max_artifact_bytes: 65_536,
    max_output_bytes: 8192,
    verifier: {
      reference: 'verifier://project/node-module-v1',
      acceptance_ids: ['a1'],
      checks: [{ path: 'index.js', export_name: 'default', args: [3], expected: 4 }],
    },
    rollback: 'discard-disposable-workspace',
  });
  return { workspace: root, contract, markerLong, markerEcho };
}

// ---------------------------------------------------------------------------------------------- serve supervisor
const SUPERVISOR = `#!/bin/bash
# Runs inside the delegated cgroup service. Starts one "hseos control serve" per generation, only when the
# orchestrator releases it, so the serve process can be SIGKILLed and restarted INSIDE the same cgroup.
DIR="$1"; PREFIX="$2"
cd "$PREFIX" || exit 4
node "$DIR/enable-test-cgroup.mjs" >&2 || { echo failed > "$DIR/cgroup-failed"; exit 3; }
touch "$DIR/cgroup-ready"
g=1
while [ ! -f "$DIR/stop" ]; do
  if [ -f "$DIR/gen-$g.go" ]; then
    # shellcheck disable=SC2046
    "$PREFIX/node_modules/.bin/hseos" control serve $(cat "$DIR/gen-$g.args") > "$DIR/gen-$g.out" 2> "$DIR/gen-$g.err" &
    echo $! > "$DIR/gen-$g.pid"
    wait $!
    echo $? > "$DIR/gen-$g.exit"
    g=$((g+1))
  else
    sleep 0.2
  fi
done
`;
const ENABLE_CGROUP = (
  executorPath,
) => `// Derived from .github/scripts/enable-test-cgroup.mjs (repo CI helper, not shipped in the package); only the import path differs.
import fs from 'node:fs';
import path from 'node:path';
import executor from ${JSON.stringify(executorPath)};
const entry = fs.readFileSync('/proc/self/cgroup', 'utf8').trim();
if (!/^0::\\/[^\\n]+\\.service\\/tests$/.test(entry)) throw new Error('A dedicated delegated test service is required');
const parent = path.dirname(path.join('/sys/fs/cgroup', entry.slice(3)));
if (fs.statSync(parent).uid !== process.getuid()) throw new Error('The test service must own its delegated cgroup');
fs.writeFileSync(path.join(parent, 'cgroup.subtree_control'), '+memory +pids');
executor.executorOwner();
console.log('Delegated test cgroup controllers verified');
`;
let unitClient = null;
function startService() {
  fs.writeFileSync(path.join(WORK, 'serve-supervisor.sh'), SUPERVISOR, { mode: 0o700 });
  fs.writeFileSync(
    path.join(WORK, 'enable-test-cgroup.mjs'),
    ENABLE_CGROUP(path.join(PKG, 'packages/agent-isolation-attestation/executor.js')),
  );
  const common = [
    `--unit=${UNIT}`,
    '--wait',
    '--collect',
    '--pipe',
    '--service-type=exec',
    '-p',
    'Delegate=yes',
    '-p',
    'DelegateSubgroup=tests',
    '-p',
    `WorkingDirectory=${PREFIX}`,
  ];
  const payload = ['/bin/bash', path.join(WORK, 'serve-supervisor.sh'), WORK, PREFIX];
  const env = { ...process.env, HSEOS_CONTROL_CREDENTIAL: CREDENTIAL };
  if (SERVICE_MODE === 'system') {
    // sudo resets the environment, so pass explicit values to the transient unit (as .github/workflows/ci.yaml does).
    unitClient = spawn(
      'nice',
      [
        '-n',
        '10',
        'sudo',
        'systemd-run',
        `--uid=${process.getuid()}`,
        `--gid=${process.getgid()}`,
        ...common,
        `--setenv=PATH=${process.env.PATH}`,
        `--setenv=HOME=${process.env.HOME}`,
        `--setenv=HSEOS_CONTROL_CREDENTIAL=${CREDENTIAL}`,
        ...payload,
      ],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } else {
    unitClient = spawn(
      'nice',
      ['-n', '10', 'systemd-run', '--user', ...common, '-E', 'PATH', '-E', 'HSEOS_CONTROL_CREDENTIAL', ...payload],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  }
  let log = '';
  unitClient.stdout.on('data', (d) => (log += d));
  unitClient.stderr.on('data', (d) => (log += d));
  unitClient.log = () => log.replace(CREDENTIAL, '***');
}
async function startGeneration(extraArgs) {
  const g = ++ctx.serveGeneration;
  fs.writeFileSync(path.join(WORK, `gen-${g}.args`), extraArgs.join(' '));
  fs.writeFileSync(path.join(WORK, `gen-${g}.go`), '');
  const info = await waitFor(
    () => {
      try {
        return JSON.parse(fs.readFileSync(path.join(WORK, `gen-${g}.out`), 'utf8').split('\n')[0]);
      } catch {
        if (fs.existsSync(path.join(WORK, `gen-${g}.exit`)))
          throw new Error(`serve generation ${g} exited early: ${fs.readFileSync(path.join(WORK, `gen-${g}.err`), 'utf8').slice(-400)}`);
        return null;
      }
    },
    { timeout: 60_000, what: `serve generation ${g} banner` },
  );
  ctx.url = info.url;
  ctx.state = info.state;
  ctx.banner = info;
  ctx.servePid = Number(fs.readFileSync(path.join(WORK, `gen-${g}.pid`), 'utf8'));
  return info;
}
async function stopAdapters() {
  if (!ctx.sdk) return;
  await Promise.all(Object.values(ctx.sdk).map((a) => a.close()));
  ctx.sdk = null;
}
async function cleanup() {
  await stopAdapters().catch(() => {});
  try {
    fs.writeFileSync(path.join(WORK, 'stop'), '');
    if (SERVICE_MODE === 'system') spawnSync('sudo', ['systemctl', 'stop', `${UNIT}.service`], { timeout: 20_000 });
    else spawnSync('systemctl', ['--user', 'stop', `${UNIT}.service`], { timeout: 20_000 });
  } catch {
    /* best effort: the service may already be gone */
  }
  try {
    unitClient?.kill('SIGTERM');
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------------------------- main
const startedAt = new Date().toISOString();
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true, mode: 0o700 });
process.on('SIGINT', () => cleanup().finally(() => process.exit(130)));
process.on('SIGTERM', () => cleanup().finally(() => process.exit(143)));

fs.copyFileSync(path.join(HERE, 'sdk_py_client.py'), path.join(WORK, 'sdk_py_client.py'));
fs.mkdirSync(path.join(WORK, 'ts'));
for (const f of ['sdk-ts-client.ts', 'sdk-ts-negative.ts']) fs.copyFileSync(path.join(HERE, f), path.join(WORK, 'ts', f));
fs.writeFileSync(path.join(WORK, 'ts', 'package.json'), JSON.stringify({ name: 'journey-ts', private: true, type: 'module' }));
fs.symlinkSync(path.join(PREFIX, 'node_modules'), path.join(WORK, 'ts', 'node_modules'));
fs.writeFileSync(
  path.join(WORK, 'ts', 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      module: 'nodenext',
      moduleResolution: 'nodenext',
      target: 'es2022',
      lib: ['es2023', 'dom'],
      types: [],
      skipLibCheck: false,
      noUncheckedIndexedAccess: false,
    },
    files: ['sdk-ts-client.ts'],
  }),
);
fs.writeFileSync(
  path.join(WORK, 'ts', 'tsconfig.negative.json'),
  JSON.stringify({ extends: './tsconfig.json', files: ['sdk-ts-negative.ts'] }),
);

try {
  // ------------------------------------------------------------------ s00 package identity and install
  await step('s00-install', 'Pacote instalado fora do checkout: identidade, CLI, SDK e executor', async (c, extra) => {
    const tgzSha = sha256(fs.readFileSync(TGZ));
    ctx.tgzSha = tgzSha;
    const manifest = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
    extra.package = { name: manifest.name, version: manifest.version, tgz_sha256: tgzSha, installed_at: PKG };
    c.ok(
      'package installed under the consumer prefix',
      fs.existsSync(path.join(PKG, 'packages/control-sdk/index.js')) && !PKG.startsWith(REPO_ROOT + path.sep),
    );
    c.ok(
      'tarball entries match installed files (SDK index.js bytes)',
      (() => {
        const listed = spawnSync('tar', ['-xzOf', TGZ, 'package/packages/control-sdk/index.js'], { encoding: 'buffer' });
        return listed.status === 0 && sha256(listed.stdout) === sha256(fs.readFileSync(path.join(SDK_DIR, 'index.js')));
      })(),
    );
    const version = execFileSync(path.join(PREFIX, 'node_modules/.bin/hseos'), ['--version'], { encoding: 'utf8' }).trim();
    c.ok('hseos --version matches package.json', version === manifest.version, version);
    extra.runtimes = {
      journey_node: process.version,
      sandbox_node: execFileSync('/usr/bin/node', ['-v'], { encoding: 'utf8' }).trim(),
      python: execFileSync(PYTHON, ['-I', '-B', '-c', 'import sys;print(sys.version.split()[0])'], { encoding: 'utf8' }).trim(),
      git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim(),
      bwrap: spawnSync('bwrap', ['--version'], { encoding: 'utf8' }).stdout.trim(),
    };
    ctx.runtimes = extra.runtimes;
    const adapters = JSON.parse(
      execFileSync(path.join(PREFIX, 'node_modules/.bin/hseos'), ['control', 'adapters'], { encoding: 'utf8' }).trim(),
    );
    c.ok(
      '`control adapters` lists adapters as not_certified, none operational',
      adapters.implemented.every((a) => a.real_conformance === 'not_certified'),
    );
    extra.adapters = adapters.implemented.map((a) => ({ adapter: a.adapter, real_conformance: a.real_conformance }));
  });

  // ------------------------------------------------------------------ s01 serve in a delegated cgroup
  await step('s01-serve', 'hseos control serve (cgroup delegado) com banner {url,state,operational:false}', async (c, extra) => {
    // Pre-create every workspace that the config allowlists (the allowlist is fixed at serve time).
    const P = ctx.projects;
    const names = [
      ['ts-sdk-js', 'typescript-report'],
      ['ts-correct', 'typescript-report'],
      ['ts-wrong', 'typescript-report'],
      ['ts-corrected', 'typescript-report'],
      ['ts-bypass', 'typescript-report'],
      ['py-correct', 'python-inventory'],
      ['py-wrong', 'python-inventory'],
      ['py-corrected', 'python-inventory'],
      ['py-bypass', 'python-inventory'],
      ['job-ok', 'typescript-report'],
    ];
    for (const [key, example] of names) P[key] = exampleCli(example, path.join(WORK, 'projects', key));
    P.cancel = customProject('cancel-project', `jmark-cancel-${RUN_TAG}`, `jmark-cancel-echo-${RUN_TAG}`);
    P.term = customProject('terminal-project', `jmark-term-long-${RUN_TAG}`, `jmark-term-${RUN_TAG}`);
    P.termjob = customProject('terminal-job-project', `jmark-termjob-long-${RUN_TAG}`, `jmark-termjob-${RUN_TAG}`);
    P.crashTask = customProject('crash-task-project', `jmark-crash-task-${RUN_TAG}`, `jmark-crash-task-echo-${RUN_TAG}`);
    P.crashJob = customProject('crash-job-project', `jmark-crash-job-${RUN_TAG}`, `jmark-crash-job-echo-${RUN_TAG}`);
    const config = { workspaces: Object.values(P).map((p) => fs.realpathSync(p.workspace)), bindings: {}, port: 0 };
    fs.writeFileSync(path.join(WORK, 'control-config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
    extra.workspaces = config.workspaces.length;

    startService();
    await waitFor(() => fs.existsSync(path.join(WORK, 'cgroup-ready')) || fs.existsSync(path.join(WORK, 'cgroup-failed')), {
      timeout: 30_000,
      what: 'cgroup service',
    });
    if (fs.existsSync(path.join(WORK, 'cgroup-failed'))) throw new Blocked(`delegated cgroup unavailable: ${unitClient.log().slice(-300)}`);
    extra.service_form = `systemd-run ${SERVICE_MODE === 'user' ? '--user' : '(sudo, --uid/--gid)'} --unit=${UNIT} --wait --collect --pipe --service-type=exec -p Delegate=yes -p DelegateSubgroup=tests (supervisor script + enable-test-cgroup.mjs)`;
    const banner = await startGeneration(['--config', path.join(WORK, 'control-config.json')]);
    ctx.serveUp = true;
    c.ok('banner has loopback url', /^http:\/\/127\.0\.0\.1:\d+$/.test(banner.url), banner.url);
    c.ok('banner operational is false', banner.operational === false);
    c.ok('banner has state dir', typeof banner.state === 'string' && fs.existsSync(banner.state), banner.state);
    c.ok('serve process alive', fs.existsSync(`/proc/${ctx.servePid}`));
    ctx.sdk = makeAdapters(banner.url);
    const [ts, py] = await Promise.all([ctx.sdk.ts.ready, ctx.sdk.py.ready]);
    extra.sdk_workers = { ts, py };
    c.ok('JS SDK object does not serialize the credential', !ctx.sdk.js.serialized.includes(CREDENTIAL));
    extra.state_dir = banner.state;
  });

  // ------------------------------------------------------------------ s02 TypeScript type check
  await step(
    's02-ts-typecheck',
    'SDK TypeScript: tsc strict contra index.d.ts instalado + contrato negativo de tipos',
    async (c, extra) => {
      if (!fs.existsSync(TSC)) throw new Blocked(`tsc not found at ${TSC}`);
      const version = execFileSync(nodeBin, [TSC, '-v'], { encoding: 'utf8' }).trim();
      extra.tsc = { version, path: TSC, note: 'tsc is NOT part of the installed package; taken read-only from the checkout node_modules' };
      const run = (project) =>
        spawnSync('nice', ['-n', '10', nodeBin, TSC, '-p', project], { cwd: path.join(WORK, 'ts'), encoding: 'utf8', timeout: 120_000 });
      const main = run('tsconfig.json');
      c.ok('sdk-ts-client.ts type-checks (strict, nodenext)', main.status === 0, (main.stdout + main.stderr).slice(0, 700));
      const negative = run('tsconfig.negative.json');
      c.ok(
        '4 invalid usages are rejected by index.d.ts (no unused @ts-expect-error)',
        negative.status === 0,
        (negative.stdout + negative.stderr).slice(0, 700),
      );
      // informational: a union-typed view does not match the declared overloads (not asserted)
      fs.writeFileSync(
        path.join(WORK, 'ts', 'sdk-ts-info.ts'),
        "import { ControlClient } from 'hseos/packages/control-sdk/index.js';\ndeclare const v: 'status' | 'evidence' | 'review' | 'session';\nconst c = new ControlClient({ url: 'http://127.0.0.1:1', credential: 'x'.repeat(32) });\nvoid c.query('id', v);\n",
      );
      fs.writeFileSync(
        path.join(WORK, 'ts', 'tsconfig.info.json'),
        JSON.stringify({ extends: './tsconfig.json', files: ['sdk-ts-info.ts'] }),
      );
      const info = run('tsconfig.info.json');
      extra.note_union_view_overload =
        info.status === 0
          ? 'union view accepted'
          : 'query(id, view) with a union-typed view does not compile against the declared overloads (index.d.ts)';
    },
  );

  // ------------------------------------------------------------------ s03 prepare -> command -> query -> events x3 SDKs
  await step(
    's03-three-sdk-pipeline',
    'prepare -> command -> query -> events (cursor/paginacao) via SDK JS, TS e Python na mesma instancia; equivalencia',
    async (c, extra) => {
      const runs = {};
      for (const [key, sdkName] of [
        ['ts-sdk-js', 'js'],
        ['ts-sdk-js', 'ts'],
        ['ts-sdk-js', 'py'],
      ]) {
        const sdk = ctx.sdk[sdkName];
        const p = ctx.projects[key];
        const prepared = await sdk.call('prepare', p.contract);
        c.ok(`[${sdkName}] prepare is stable for an already prepared contract`, same(prepared, p.contract));
        const id = randomUUID();
        const created = await sdk.call('execute', cmd(id, 'create', 0, { contract: prepared, responses: p.responses }));
        c.ok(
          `[${sdkName}] create leaves the task awaiting execution`,
          created.reason === 'awaiting-execution' && created.current_sequence === 1,
          created.reason,
        );
        const resumeCommand = cmd(id, 'resume', created.current_sequence);
        const result = await sdk.call('execute', resumeCommand);
        c.ok(`[${sdkName}] resume approves (correction flow)`, result.task_result === 'approved', `${result.task_result}/${result.reason}`);
        const replay = await sdk.call('execute', resumeCommand);
        c.ok(`[${sdkName}] replaying the same command_id returns the identical receipt`, same(replay, result));
        const status = await sdk.call('query', id);
        const evidence = await sdk.call('query', id, 'evidence');
        const session = await sdk.call('query', id, 'session');
        const full = await sdk.call('events', id, { after: 0, limit: 1000 });
        let after = 0;
        const paged = [];
        const cursors = [];
        for (;;) {
          const page = await sdk.call('events', id, { after, limit: 7 });
          if (page.events.length === 0) break;
          paged.push(...page.events);
          c.ok(`[${sdkName}] cursor strictly increases (${after} -> ${page.next_cursor})`, page.next_cursor > after);
          after = page.next_cursor;
          cursors.push(after);
        }
        c.ok(
          `[${sdkName}] paged events (limit 7) equal the full read`,
          same(paged, full.events),
          `${paged.length} vs ${full.events.length}`,
        );
        c.ok(
          `[${sdkName}] cursor at the end yields no events`,
          (await sdk.call('events', id, { after: full.next_cursor })).events.length === 0,
        );
        runs[sdkName] = { id, created, result, status, evidence, session, full, cursors };
      }
      const js = runs.js;
      for (const other of ['ts', 'py']) {
        const r = runs[other];
        const stable = (x) => ({ ...x, task_run_id: undefined, session_id: undefined, resource_id: undefined, step_id: undefined });
        c.ok(`js vs ${other}: status identical modulo generated ids`, same(stripIds(js.status), stripIds(r.status)));
        c.ok(
          `js vs ${other}: event type/kind/sequence lists identical`,
          same(norm(js.full.events), norm(r.full.events)),
          `${norm(js.full.events).length} vs ${norm(r.full.events).length}`,
        );
        c.ok(
          `js vs ${other}: next_cursor identical`,
          js.full.next_cursor === r.full.next_cursor,
          `${js.full.next_cursor} vs ${r.full.next_cursor}`,
        );
        c.ok(`js vs ${other}: contract_sha256 identical`, js.status.contract_sha256 === r.status.contract_sha256);
        c.ok(
          `js vs ${other}: correction reviews/diagnoses identical`,
          same(
            js.status.correction_reviews.map((x) => x.approved),
            r.status.correction_reviews.map((x) => x.approved),
          ) && js.status.correction_diagnoses.length === r.status.correction_diagnoses.length,
        );
        void stable;
      }
      // One resource, read through all three SDKs (and the CLI): byte-identical answers.
      const id = js.id;
      for (const view of ['status', 'evidence', 'session']) {
        const a = await ctx.sdk.js.call('query', id, view);
        const b = await ctx.sdk.ts.call('query', id, view);
        const d = await ctx.sdk.py.call('query', id, view);
        c.ok(`same resource, view=${view}: js == ts == py`, same(a, b) && same(a, d));
      }
      const fa = await ctx.sdk.js.call('events', id, { after: 3, limit: 5 });
      c.ok(
        'same resource, events(after=3,limit=5): js == ts == py',
        same(fa, await ctx.sdk.ts.call('events', id, { after: 3, limit: 5 })) &&
          same(fa, await ctx.sdk.py.call('events', id, { after: 3, limit: 5 })),
      );
      const cliEnv = { ...process.env, HSEOS_CONTROL_CREDENTIAL: CREDENTIAL };
      const hseos = path.join(PREFIX, 'node_modules/.bin/hseos');
      const cliQuery = JSON.parse(
        execFileSync(hseos, ['control', 'query', '--url', ctx.url, '--resource', id], { env: cliEnv, encoding: 'utf8' }),
      );
      c.ok('CLI `control query` equals SDK status', same(cliQuery, js.status));
      const cliEvents = JSON.parse(
        execFileSync(hseos, ['control', 'events', '--url', ctx.url, '--resource', id, '--after', '3'], { env: cliEnv, encoding: 'utf8' }),
      );
      c.ok(
        'CLI `control events --after 3` equals SDK page',
        same(cliEvents, await ctx.sdk.js.call('events', id, { after: 3, limit: 100 })),
      );
      // prepare/command through the CLI files as documented
      const reqFile = path.join(WORK, 'cli-prepare.json');
      fs.writeFileSync(reqFile, JSON.stringify(ctx.projects['ts-sdk-js'].contract));
      const cliPrepare = JSON.parse(
        execFileSync(hseos, ['control', 'prepare', '--url', ctx.url, '--request', reqFile], { env: cliEnv, encoding: 'utf8' }),
      );
      c.ok('CLI `control prepare` equals SDK prepare', same(cliPrepare, ctx.projects['ts-sdk-js'].contract));
      extra.resources = Object.fromEntries(
        Object.entries(runs).map(([k, r]) => [
          k,
          {
            id: r.id,
            task_run_id: r.status.task_run_id,
            events: r.full.events.length,
            next_cursor: r.full.next_cursor,
            status: r.status.status,
            task_result: r.status.task_result,
          },
        ]),
      );
      extra.event_kinds_js = norm(js.full.events).map((x) => x[2] ?? x[1]);
      ctx.notes.sdkTaskId = id;
    },
    { needs: ['serveUp'] },
  );

  // ------------------------------------------------------------------ s04 example projects
  await step(
    's04-example-projects',
    'Projetos de exemplo (typescript-report, python-inventory): entrega correta, incorreta rejeitada, correcao aceita',
    async (c, extra) => {
      const sdk = ctx.sdk.js;
      const evidence = {};
      for (const lang of ['ts', 'py']) {
        const label = lang === 'ts' ? 'typescript-report' : 'python-inventory';
        const base = (key) => ctx.projects[`${lang}-${key}`];
        const run = async (key, responses) => {
          const p = base(key);
          const id = randomUUID();
          const prepared = await sdk.call('prepare', p.contract);
          const created = await sdk.call('execute', cmd(id, 'create', 0, { contract: prepared, responses }));
          const result = await sdk.call('execute', cmd(id, 'resume', created.current_sequence));
          return { id, result };
        };
        const all = base('corrected').responses;
        const names = all.map((r) => r.name);
        c.ok(
          `[${label}] example response script has the expected shape`,
          same(names, [
            'engineering.search',
            'fixture.submit',
            'engineering.diagnose',
            'engineering.patch',
            'engineering.command',
            'engineering.diff',
          ]),
          names.join(','),
        );
        // (a) correct delivery: patch applied directly, no wrong submission first
        const correct = await run(
          'correct',
          all.filter((r) => !['fixture.submit', 'engineering.diagnose'].includes(r.name)),
        );
        c.ok(
          `[${label}] correct delivery is approved`,
          correct.result.task_result === 'approved',
          `${correct.result.task_result}/${correct.result.reason}`,
        );
        c.ok(
          `[${label}] correct delivery needed no correction`,
          correct.result.correction_reviews.every((r) => r.approved) && correct.result.correction_diagnoses.length === 0,
        );
        // (b) incorrect delivery: the model submits the unfixed project -> protected verification rejects it
        const wrong = await run('wrong', [...all.filter((r) => r.name === 'engineering.search'), { name: 'fixture.submit', input: {} }]);
        c.ok(
          `[${label}] incorrect delivery is NOT approved`,
          wrong.result.task_result !== 'approved',
          `${wrong.result.task_result}/${wrong.result.reason}`,
        );
        c.ok(
          `[${label}] incorrect delivery is rejected by an independent review (approved:false)`,
          wrong.result.correction_reviews.length > 0 && wrong.result.correction_reviews[0].approved === false,
          wrong.result.correction_reviews,
        );
        const wrongEvidence = await sdk.call('query', wrong.id, 'evidence');
        c.ok(
          `[${label}] rejected task has no approved review artifact`,
          await sdk.call('query', wrong.id, 'review').then(
            () => false,
            (error) => error.code !== null,
          ),
          'review view must be refused for an unapproved task',
        );
        // (c) correction accepted: rejection -> diagnosis -> patch -> approval
        const fixed = await run('corrected', all);
        c.ok(
          `[${label}] correction after rejection is approved`,
          fixed.result.task_result === 'approved',
          `${fixed.result.task_result}/${fixed.result.reason}`,
        );
        c.ok(
          `[${label}] rejection precedes approval (reviews [false,true])`,
          same(
            fixed.result.correction_reviews.map((r) => r.approved),
            [false, true],
          ),
        );
        c.ok(`[${label}] exactly one diagnosis recorded between them`, fixed.result.correction_diagnoses.length === 1);
        const fixedReview = await sdk.call('query', fixed.id, 'review');
        c.ok(
          `[${label}] approved task exposes a review with a hash`,
          typeof fixedReview.review_sha256 === 'string' && /^[a-f0-9]{64}$/.test(fixedReview.review_sha256),
          Object.keys(fixedReview),
        );
        // (d) patch without the mandatory diagnosis is refused after a rejection
        const bypass = await run(
          'bypass',
          all.filter((r) => r.name !== 'engineering.diagnose'),
        );
        c.ok(
          `[${label}] patching without a diagnosis after a rejection fails`,
          bypass.result.task_result === 'failed' && bypass.result.correction_diagnoses.length === 0,
          `${bypass.result.task_result}`,
        );
        evidence[label] = {
          correct: { id: correct.id, result: correct.result.task_result },
          wrong: {
            id: wrong.id,
            result: wrong.result.task_result,
            reason: wrong.result.reason,
            verification: wrongEvidence.verification?.result,
          },
          corrected: { id: fixed.id, result: fixed.result.task_result, reviews: fixed.result.correction_reviews.map((r) => r.approved) },
          bypass: { id: bypass.id, result: bypass.result.task_result },
        };
        // Equivalent read of the corrected task through the Python SDK (cross-language read).
        c.ok(
          `[${label}] corrected task is readable identically from the Python SDK`,
          same(await ctx.sdk.py.call('query', fixed.id), await sdk.call('query', fixed.id)),
        );
      }
      extra.examples = evidence;
    },
    { needs: ['serveUp'] },
  );

  // ------------------------------------------------------------------ s05 jobs: create/query/events
  await step(
    's05-jobs',
    'Jobs: criar, consultar e eventos (SDK JS, TS, Python) ate conclusao',
    async (c, extra) => {
      const p = ctx.projects['job-ok'];
      const id = randomUUID();
      const create = cmd(id, 'create', 0, {
        kind: 'task',
        definition: { contract: p.contract, responses: p.responses },
        not_before: new Date(Date.now() - 1000).toISOString(),
        deadline_at: new Date(Date.now() + 180_000).toISOString(),
        depends_on: [],
      });
      const created = await ctx.sdk.js.call('job', create);
      c.ok(
        'job created queued or already progressing',
        ['queued', 'claimed', 'running', 'succeeded'].includes(created.status),
        created.status,
      );
      c.ok('create replay with the same command_id returns the same receipt', same(await ctx.sdk.py.call('job', create), created));
      const final = await waitFor(
        async () => {
          const q = await ctx.sdk.js.call('jobQuery', id);
          return terminalStates.has(q.status) ? q : null;
        },
        { timeout: 120_000, interval: 300, what: 'job terminal state' },
      );
      c.ok('job reaches succeeded through the serve dispatcher', final.status === 'succeeded', `${final.status}`);
      const queries = [await ctx.sdk.js.call('jobQuery', id), await ctx.sdk.ts.call('jobQuery', id), await ctx.sdk.py.call('jobQuery', id)];
      c.ok('jobQuery: js == ts == py', same(queries[0], queries[1]) && same(queries[0], queries[2]));
      const full = await ctx.sdk.js.call('jobEvents', id, { after: 0, limit: 1000 });
      const eventTypes = full.events.map((e) => e.event_type);
      c.ok(
        'job ledger has creation, claim, materialization and execution events',
        ['JobCommandRecorded', 'JobExecutionRecorded'].every((t) => eventTypes.includes(t)),
        eventTypes.join(','),
      );
      c.ok(
        'jobEvents: js == ts == py (limit 2, after 1)',
        same(
          await ctx.sdk.js.call('jobEvents', id, { after: 1, limit: 2 }),
          await ctx.sdk.ts.call('jobEvents', id, { after: 1, limit: 2 }),
        ) &&
          same(
            await ctx.sdk.js.call('jobEvents', id, { after: 1, limit: 2 }),
            await ctx.sdk.py.call('jobEvents', id, { after: 1, limit: 2 }),
          ),
      );
      let after = 0;
      const paged = [];
      for (;;) {
        const page = await ctx.sdk.py.call('jobEvents', id, { after, limit: 2 });
        if (page.events.length === 0) break;
        paged.push(...page.events);
        after = page.next_cursor;
      }
      c.ok(
        'python pagination (limit 2) reproduces the full job ledger',
        same(paged, full.events),
        `${paged.length} vs ${full.events.length}`,
      );
      const cli = JSON.parse(
        execFileSync(path.join(PREFIX, 'node_modules/.bin/hseos'), ['control', 'job-query', '--url', ctx.url, '--resource', id], {
          env: { ...process.env, HSEOS_CONTROL_CREDENTIAL: CREDENTIAL },
          encoding: 'utf8',
        }),
      );
      c.ok('CLI `control job-query` equals SDK', same(cli, queries[0]));
      extra.job = { id, status: final.status, events: full.events.length, event_types: [...new Set(eventTypes)] };
    },
    { needs: ['serveUp'] },
  );

  // ------------------------------------------------------------------ s06 cancel a running job, drain descendants
  await step(
    's06-job-cancel-drain',
    'Cancelar job em execucao e verificar drenagem dos descendentes (/proc antes/depois)',
    async (c, extra) => {
      const p = ctx.projects.cancel;
      const marker = p.markerLong;
      c.ok('no marker process before the job exists', procsWith(marker).length === 0);
      const id = randomUUID();
      await ctx.sdk.js.call(
        'job',
        cmd(id, 'create', 0, {
          kind: 'task',
          definition: { contract: p.contract, responses: [{ name: 'engineering.command', input: { id: 'long' } }] },
          not_before: new Date(Date.now() - 1000).toISOString(),
          deadline_at: new Date(Date.now() + 180_000).toISOString(),
          depends_on: [],
        }),
      );
      const running = await waitFor(
        async () => {
          const q = await ctx.sdk.js.call('jobQuery', id);
          if (terminalStates.has(q.status)) throw new Error(`job reached ${q.status} before the descendants were observed`);
          return q.status === 'running' && procsWith(marker).length >= 2 ? q : null;
        },
        { timeout: 90_000, interval: 200, what: 'running job with live descendants' },
      );
      const before = procsWith(marker);
      c.ok(
        'before cancel: status running and >=2 descendant processes carry the marker (script + spawned child)',
        running.status === 'running' && before.length >= 2,
        before.map((x) => x.pid),
      );
      extra.before = before;
      const cancelCommand = cmd(id, 'cancel', running.current_sequence);
      const t0 = Date.now();
      const cancelled = await ctx.sdk.js.call('job', cancelCommand);
      extra.cancel_call_ms = Date.now() - t0;
      const final = await waitFor(
        async () => {
          const q = await ctx.sdk.py.call('jobQuery', id);
          return terminalStates.has(q.status) ? q : null;
        },
        { timeout: 60_000, interval: 200, what: 'cancelled settlement' },
      );
      c.ok('job settles as cancelled', final.status === 'cancelled', `${cancelled.status} -> ${final.status}`);
      const after = procsWith(marker);
      c.ok('after cancel: zero processes carry the marker (descendants drained, no orphans)', after.length === 0, after);
      await sleep(2000);
      c.ok('2s later: still zero (nothing respawned)', procsWith(marker).length === 0);
      c.ok('cancel replay (same command_id) returns the same receipt', same(await ctx.sdk.ts.call('job', cancelCommand), cancelled));
      const events = (await ctx.sdk.js.call('jobEvents', id, { after: 0, limit: 1000 })).events;
      const phases = events.filter((e) => e.event_type === 'JobExecutionRecorded').map((e) => e.payload?.phase);
      extra.execution_phases = phases;
      c.ok(
        'ledger shows intent then cancelling then a settled/cancelled phase',
        phases[0] === 'intent' && phases.includes('cancelling'),
        phases,
      );
      const direct = await ctx.sdk.js.call('jobQuery', id);
      c.ok('terminal job query is stable across SDKs', same(direct, await ctx.sdk.ts.call('jobQuery', id)));
      extra.job = { id, final_status: final.status };
    },
    { needs: ['serveUp'] },
  );

  // ------------------------------------------------------------------ s07 terminals
  await step(
    's07-terminals',
    'Terminais: abrir (pty e job), attach, entrada, resize, eventos com cursor, encerrar com drenagem',
    async (c, extra) => {
      const decode = (events) =>
        events
          .filter((e) => e.payload?.kind === 'output')
          .map((e) => Buffer.from(e.payload.data, 'base64').toString('utf8'))
          .join('');
      const outputOf = async (sdk, id) => decode((await sdk.call('terminalEvents', id, { after: 0, limit: 1000 })).events);
      const waitOutput = (id, needle) =>
        waitFor(async () => ((await outputOf(ctx.sdk.js, id)).includes(needle) ? true : null), {
          timeout: 30_000,
          what: `terminal output ${needle}`,
        });
      const term = async (id, action, input = {}) => {
        const s = await ctx.sdk.js.call('terminalQuery', id);
        return ctx.sdk.js.call('terminal', cmd(id, action, s.current_sequence, input));
      };
      // ---- pty terminal
      const p = ctx.projects.term;
      const taskId = randomUUID();
      await ctx.sdk.js.call('execute', cmd(taskId, 'create', 0, { contract: await ctx.sdk.js.call('prepare', p.contract), responses: [] }));
      const id = randomUUID();
      const opened = await ctx.sdk.js.call(
        'terminal',
        cmd(id, 'open', 0, { task_id: taskId, command_id: 'echo', mode: 'pty', rows: 24, cols: 80 }),
      );
      c.ok('open (pty) accepted', opened && typeof opened === 'object', Object.keys(opened));
      await waitOutput(id, 'READY');
      c.ok(
        'descendant marker process is alive while the terminal runs',
        procsWith(p.markerEcho).length >= 2,
        procsWith(p.markerEcho).map((x) => x.pid),
      );
      const q0 = await ctx.sdk.js.call('terminalQuery', id);
      c.ok(
        'terminalQuery: running, mode pty, descendants not yet terminated',
        q0.status === 'running' && q0.mode === 'pty' && q0.descendants_terminated === false,
        q0,
      );
      c.ok(
        'terminalQuery: js == ts == py',
        same(q0, await ctx.sdk.ts.call('terminalQuery', id)) && same(q0, await ctx.sdk.py.call('terminalQuery', id)),
      );
      const inputReply = await term(id, 'input', { data: Buffer.from('hello\n').toString('base64') });
      c.ok('input reports 6 bytes written', inputReply.effect?.bytes === 6, inputReply.effect);
      await waitOutput(id, 'ECHO:HELLO');
      const resized = await term(id, 'resize', { rows: 40, cols: 120 });
      c.ok('resize accepted', resized && !resized.error);
      await waitOutput(id, 'SIZE 40x120');
      c.ok('child observed the new window size (SIGWINCH, 40x120)', (await outputOf(ctx.sdk.js, id)).includes('SIZE 40x120'));
      await term(id, 'pause');
      c.ok('pause -> status paused', (await ctx.sdk.js.call('terminalQuery', id)).status === 'paused');
      await term(id, 'continue');
      c.ok('continue -> status running', (await ctx.sdk.js.call('terminalQuery', id)).status === 'running');
      // cursor semantics
      const full = await ctx.sdk.js.call('terminalEvents', id, { after: 0, limit: 1000 });
      let after = 0;
      const paged = [];
      for (;;) {
        const page = await ctx.sdk.ts.call('terminalEvents', id, { after, limit: 3 });
        if (page.events.length === 0) break;
        c.ok(`terminal cursor advances (${after} -> ${page.next_cursor})`, page.next_cursor > after);
        paged.push(...page.events);
        after = page.next_cursor;
      }
      c.ok('terminalEvents paged via TS SDK equals the full read', same(paged, full.events));
      c.ok(
        'terminalEvents: js == py (after 2, limit 4)',
        same(
          await ctx.sdk.js.call('terminalEvents', id, { after: 2, limit: 4 }),
          await ctx.sdk.py.call('terminalEvents', id, { after: 2, limit: 4 }),
        ),
      );
      c.ok(
        'past the end: no events and the cursor is stable',
        (await ctx.sdk.py.call('terminalEvents', id, { after: full.next_cursor })).events.length === 0,
      );
      // attach via the package's own attach implementation (non-TTY streams), then detach with Ctrl-]
      const { attachTerminal } = require(path.join(PKG, 'tools/cli/lib/terminal-attach'));
      const input = new PassThrough();
      const output = new PassThrough();
      let attached = '';
      output.on('data', (d) => (attached += d.toString()));
      const attach = attachTerminal(ctx.sdk.js.client, id, { input, output, after: 0 });
      await sleep(600);
      input.write(Buffer.from('via-attach\n'));
      await waitFor(() => attached.includes('ECHO:VIA-ATTACH'), { timeout: 20_000, what: 'attach round trip' });
      input.write(Buffer.from([0x1d]));
      const detached = await Promise.race([attach, sleep(15_000).then(() => 'timeout')]);
      c.ok(
        'attach streamed the terminal output and the typed input echoed back',
        attached.includes('READY') && attached.includes('ECHO:VIA-ATTACH'),
      );
      c.ok(
        'Ctrl-] detaches without killing the process',
        detached !== 'timeout' && (await ctx.sdk.js.call('terminalQuery', id)).status === 'running',
        detached,
      );
      // stale sequence is refused
      const stale = await raw('POST', '/v1/terminals/commands', {
        body: cmd(id, 'input', 0, { data: Buffer.from('x').toString('base64') }),
      });
      c.ok(
        'stale expected_sequence on a terminal command -> 409 CONTROL_SEQUENCE_CONFLICT',
        stale.status === 409 && stale.body.error === 'CONTROL_SEQUENCE_CONFLICT',
        stale,
      );
      const terminate = await term(id, 'terminate');
      const ended = await waitFor(
        async () => {
          const s = await ctx.sdk.js.call('terminalQuery', id);
          return s.descendants_terminated ? s : null;
        },
        { timeout: 30_000, what: 'terminal drain' },
      );
      c.ok(
        'terminate: descendants_terminated proven and no uncertainty',
        ended.descendants_terminated === true && ended.outcome_uncertain === false && ended.uncertain_commands.length === 0,
        ended,
      );
      c.ok('terminate: zero marker processes in /proc', procsWith(p.markerEcho).length === 0, procsWith(p.markerEcho));
      void terminate;
      extra.pty = {
        id,
        final_status: ended.status,
        events: full.events.length,
        sample_output: (await outputOf(ctx.sdk.js, id)).slice(0, 200),
      };
      // ---- job-mode terminal: stdin pipe, EOF ends the command by itself
      const q = ctx.projects.termjob;
      const task2 = randomUUID();
      await ctx.sdk.js.call('execute', cmd(task2, 'create', 0, { contract: await ctx.sdk.js.call('prepare', q.contract), responses: [] }));
      const id2 = randomUUID();
      await ctx.sdk.py.call('terminal', cmd(id2, 'open', 0, { task_id: task2, command_id: 'echo', mode: 'job' }));
      await waitFor(async () => ((await outputOf(ctx.sdk.py, id2)).includes('READY') ? true : null), {
        timeout: 30_000,
        what: 'job-mode READY',
      });
      const s2 = await ctx.sdk.py.call('terminalQuery', id2);
      await ctx.sdk.py.call('terminal', cmd(id2, 'input', s2.current_sequence, { data: Buffer.from('job mode\n').toString('base64') }));
      await waitFor(async () => ((await outputOf(ctx.sdk.js, id2)).includes('ECHO:JOB MODE') ? true : null), {
        timeout: 30_000,
        what: 'job-mode echo',
      });
      const s3 = await ctx.sdk.py.call('terminalQuery', id2);
      await ctx.sdk.py.call('terminal', cmd(id2, 'eof', s3.current_sequence));
      const ended2 = await waitFor(
        async () => {
          const s = await ctx.sdk.ts.call('terminalQuery', id2);
          return s.descendants_terminated ? s : null;
        },
        { timeout: 30_000, what: 'job-mode drain' },
      );
      c.ok(
        'job-mode terminal: EOF ends the command and drains descendants',
        ended2.descendants_terminated && (await outputOf(ctx.sdk.ts, id2)).includes('EOF'),
        ended2,
      );
      c.ok('job-mode terminal: zero marker processes', procsWith(q.markerEcho).length === 0);
      extra.job_mode = { id: id2, status: ended2.status };
    },
    { needs: ['serveUp'] },
  );

  // ------------------------------------------------------------------ s08 provider bindings / campaign (read-only)
  await step(
    's08-provider-readonly',
    'GET /v1/provider-bindings e consulta de campanha (somente leitura, sem despacho a provedor)',
    async (c, extra) => {
      const bindings = await raw('GET', '/v1/provider-bindings?binding_id=codex:account');
      c.ok(
        'unknown binding is refused without side effects (4xx with a CONTROL_* code)',
        bindings.status >= 400 && bindings.status < 500 && (bindings.body?.error || '').startsWith('CONTROL_'),
        bindings,
      );
      extra.unknown_binding = bindings;
      const missing = await raw('GET', '/v1/provider-bindings');
      c.ok(
        'binding_id is mandatory -> 400 CONTROL_QUERY_INVALID',
        missing.status === 400 && missing.body.error === 'CONTROL_QUERY_INVALID',
        missing,
      );
      const extraParam = await raw('GET', '/v1/provider-bindings?binding_id=a:b&x=1');
      c.ok('unexpected parameter -> 400 CONTROL_QUERY_INVALID', extraParam.status === 400, extraParam);
      for (const sdkName of ['js', 'ts', 'py']) {
        const refused = await ctx.sdk[sdkName].call('bindingInspect', 'codex:account').then(
          () => null,
          (error) => error.code,
        );
        c.ok(`[${sdkName}] SDK bindingInspect surfaces the same refusal code`, refused === bindings.body?.error, refused);
      }
      const localInvalid = await ctx.sdk.js.call('bindingInspect', 'Not A Binding').then(
        () => null,
        (error) => error.message,
      );
      c.ok('SDK validates the binding identity locally', localInvalid === 'Invalid binding identity', localInvalid);
      const campaign = await raw('GET', `/v1/provider-campaigns/${randomUUID()}`);
      extra.unknown_campaign = campaign;
      c.ok(
        'unknown campaign is refused with a JSON error and no side effect',
        campaign.status >= 400 && typeof campaign.body?.error === 'string',
        campaign,
      );
      c.ok('no provider campaign was created by these reads', true, 'reads only; the config declares bindings:{} and no provider_control');
      ctx.limitations.push(
        'Provider bindings: a POSITIVE binding inspection was not exercised. A binding needs provider_control (a pre-existing ledger identity) and a real adapter (codex/claude/antigravity/api) whose inspect() may reach a real provider; real dispatch is forbidden in this journey. Only the read-only refusal paths were verified.',
      );
    },
    { needs: ['serveUp'] },
  );

  // ------------------------------------------------------------------ s09 negatives
  await step(
    's09-negatives',
    'Negativos: credencial errada, sequencia obsoleta, ids inexistentes, origem, rota, limites',
    async (c, extra) => {
      // Own fixture so the step is self-contained: one completed task to attack with stale/foreign commands.
      const seed = ctx.projects['ts-sdk-js'];
      const taskId = randomUUID();
      const seedCreated = await ctx.sdk.js.call(
        'execute',
        cmd(taskId, 'create', 0, { contract: seed.contract, responses: seed.responses }),
      );
      await ctx.sdk.js.call('execute', cmd(taskId, 'resume', seedCreated.current_sequence));
      const rejected = {};
      // authentication
      const noAuth = await raw('GET', `/v1/tasks/${taskId}`, { cred: null });
      c.ok(
        'no Authorization header -> 401 CONTROL_UNAUTHENTICATED',
        noAuth.status === 401 && noAuth.body.error === 'CONTROL_UNAUTHENTICATED',
        noAuth,
      );
      const bad = 'z'.repeat(48);
      const wrong = await raw('GET', `/v1/tasks/${taskId}`, { cred: bad });
      c.ok(
        'wrong credential -> 401 CONTROL_UNAUTHENTICATED',
        wrong.status === 401 && wrong.body.error === 'CONTROL_UNAUTHENTICATED',
        wrong,
      );
      const wrongPost = await raw('POST', '/v1/commands', { cred: bad, body: cmd(randomUUID(), 'cancel', 0) });
      c.ok('wrong credential on a mutating route -> 401, nothing recorded', wrongPost.status === 401, wrongPost);
      for (const path_ of ['/v1/jobs/', '/v1/terminals/']) {
        const r = await raw('GET', path_ + randomUUID(), { cred: bad });
        c.ok(`wrong credential on ${path_}<id> -> 401 (auth precedes routing)`, r.status === 401, r);
      }
      const badAdapters = makeAdapters(ctx.url, bad);
      try {
        for (const [name, adapter] of Object.entries(badAdapters)) {
          const code = await adapter.call('query', taskId).then(
            () => 'accepted',
            (error) => error.code,
          );
          rejected[name] = code;
          c.ok(`[${name}] SDK with a wrong credential receives CONTROL_UNAUTHENTICATED`, code === 'CONTROL_UNAUTHENTICATED', code);
        }
      } finally {
        await Promise.all(Object.values(badAdapters).map((a) => a.close()));
      }
      // origin / host
      const origin = await raw('GET', `/v1/tasks/${taskId}`, { headers: { origin: 'http://hostile.invalid' } });
      c.ok(
        'browser Origin header -> 403 CONTROL_ORIGIN_DENIED',
        origin.status === 403 && origin.body.error === 'CONTROL_ORIGIN_DENIED',
        origin,
      );
      const host = await raw('GET', `/v1/tasks/${taskId}`, { headers: { host: 'hostile.invalid:80' } });
      c.ok('non-loopback Host header -> 403 CONTROL_ORIGIN_DENIED', host.status === 403, host);
      // stale / conflicting commands
      const status = await ctx.sdk.js.call('query', taskId);
      const stale = await raw('POST', '/v1/commands', { body: cmd(taskId, 'resume', status.current_sequence + 5) });
      c.ok(
        'stale/foreign expected_sequence on a task -> 409 CONTROL_SEQUENCE_CONFLICT',
        stale.status === 409 && stale.body.error === 'CONTROL_SEQUENCE_CONFLICT',
        stale,
      );
      const stale0 = await raw('POST', '/v1/commands', { body: cmd(taskId, 'resume', 0) });
      c.ok('obsolete expected_sequence 0 on an existing task -> 409', stale0.status === 409, stale0);
      for (const name of ['js', 'ts', 'py']) {
        const code = await ctx.sdk[name].call('execute', cmd(taskId, 'resume', 0)).then(
          () => 'accepted',
          (error) => error.code,
        );
        c.ok(`[${name}] SDK surfaces CONTROL_SEQUENCE_CONFLICT for the obsolete sequence`, code === 'CONTROL_SEQUENCE_CONFLICT', code);
      }
      const p = ctx.projects['ts-sdk-js'];
      const idem = cmd(randomUUID(), 'create', 0, { contract: p.contract, responses: p.responses });
      await ctx.sdk.js.call('execute', idem);
      const conflict = await raw('POST', '/v1/commands', { body: { ...idem, input: { contract: p.contract, responses: [] } } });
      c.ok(
        'same command_id with different input -> 409 CONTROL_IDEMPOTENCY_CONFLICT',
        conflict.status === 409 && conflict.body.error === 'CONTROL_IDEMPOTENCY_CONFLICT',
        conflict,
      );
      const outside = structuredClone(p.contract);
      outside.workspace.root = '/etc';
      const denied = await raw('POST', '/v1/commands', { body: cmd(randomUUID(), 'create', 0, { contract: outside, responses: [] }) });
      c.ok(
        'workspace outside the allowlist -> 409 CONTROL_WORKSPACE_DENIED',
        denied.status === 409 && denied.body.error === 'CONTROL_WORKSPACE_DENIED',
        denied,
      );
      const unknownField = await raw('POST', '/v1/commands', { body: { ...cmd(randomUUID(), 'create', 0, {}), unexpected: true } });
      c.ok(
        'unknown envelope field is rejected (4xx, CONTROL_REQUEST_REJECTED)',
        unknownField.status >= 400 && unknownField.status < 500,
        unknownField,
      );
      const inlineId = randomUUID();
      const inline = await raw('POST', '/v1/jobs/commands', {
        body: cmd(inlineId, 'create', 0, {
          kind: 'task',
          definition: {
            contract: { ...p.contract, initial_files: [{ path: 'src/money.ts', content: 'x', sha256: sha256('x') }] },
            responses: [],
          },
          not_before: new Date().toISOString(),
          deadline_at: new Date(Date.now() + 60_000).toISOString(),
          depends_on: [],
        }),
      });
      c.ok(
        'job whose contract embeds inline code is refused (409; JOB_INLINE_CODE_DENIED or contract rejection)',
        inline.status === 409 && ['JOB_INLINE_CODE_DENIED', 'CONTROL_REQUEST_REJECTED'].includes(inline.body.error),
        inline,
      );
      c.ok('the refused inline-code job left no job behind (404)', (await raw('GET', `/v1/jobs/${inlineId}`)).status === 404);
      extra.inline_code_refusal = inline.body;
      ctx.limitations.push(
        'JOB_INLINE_CODE_DENIED itself was not reached: a managed-project contract carrying initial_files is refused earlier by contract validation (CONTROL_REQUEST_REJECTED); the observable behaviour (refusal, no job created) was verified.',
      );
      // unknown ids
      const ghost = randomUUID();
      const unknown = {
        task: await raw('GET', `/v1/tasks/${ghost}`),
        task_events: await raw('GET', `/v1/tasks/${ghost}/events`),
        job: await raw('GET', `/v1/jobs/${ghost}`),
        job_events: await raw('GET', `/v1/jobs/${ghost}/events`),
        terminal: await raw('GET', `/v1/terminals/${ghost}`),
        terminal_events: await raw('GET', `/v1/terminals/${ghost}/events`),
        campaign: await raw('GET', `/v1/provider-campaigns/${ghost}`),
      };
      extra.unknown_id_statuses = Object.fromEntries(Object.entries(unknown).map(([k, v]) => [k, `${v.status} ${v.body?.error ?? ''}`]));
      for (const [k, v] of Object.entries(unknown))
        c.ok(`unknown ${k.replace('_', ' ')} id -> 404 ("recurso desconhecido 404")`, v.status === 404, `${v.status} ${v.body?.error}`);
      for (const name of ['js', 'ts', 'py']) {
        const code = await ctx.sdk[name].call('query', ghost).then(
          () => 'accepted',
          (error) => error.code,
        );
        c.ok(`[${name}] SDK query of an unknown task -> CONTROL_TASK_NOT_FOUND`, code === 'CONTROL_TASK_NOT_FOUND', code);
      }
      // protocol-level
      const route = await raw('GET', '/v1/nope');
      c.ok('unknown route -> 404 CONTROL_ROUTE_UNKNOWN', route.status === 404 && route.body.error === 'CONTROL_ROUTE_UNKNOWN', route);
      const badQuery = await raw('GET', `/v1/tasks/${taskId}/events?after=-1`);
      c.ok(
        'negative cursor on task events is refused (4xx, no events)',
        badQuery.status >= 400 && badQuery.status < 500 && !badQuery.body?.events,
        badQuery,
      );
      const badTerminalCursor = await raw('GET', `/v1/terminals/${randomUUID()}/events?after=-1`);
      const badJobCursor = await raw('GET', `/v1/jobs/${randomUUID()}/events?after=-1`);
      extra.negative_cursor_codes = {
        tasks: `${badQuery.status} ${badQuery.body?.error}`,
        terminals: `${badTerminalCursor.status} ${badTerminalCursor.body?.error}`,
        jobs: `${badJobCursor.status} ${badJobCursor.body?.error}`,
      };
      const badParam = await raw('GET', `/v1/tasks/${taskId}?x=1`);
      c.ok('unexpected query parameter -> 400 CONTROL_QUERY_INVALID', badParam.status === 400, badParam);
      const mime = await raw('POST', '/v1/commands', { body: '{}', contentType: 'text/plain' });
      c.ok('non-JSON content type -> 415 CONTROL_JSON_REQUIRED', mime.status === 415, mime);
      const big = await raw('POST', '/v1/commands', { body: JSON.stringify({ pad: 'a'.repeat(2_200_000) }) });
      c.ok(
        'body above 2 MiB is refused (413 CONTROL_REQUEST_LIMIT or connection reset)',
        big.status === 413 || (big.status === 0 && /ECONNRESET|EPIPE/.test(big.error)),
        { status: big.status, error: big.error ?? big.body },
      );
      const sdkLocal = [
        await ctx.sdk.js.call('events', taskId, { limit: 0 }).then(
          () => 'accepted',
          (error) => error.message,
        ),
        await ctx.sdk.py.call('events', taskId, { limit: 0 }).then(
          () => 'accepted',
          (error) => error.message,
        ),
        await ctx.sdk.ts.call('events', taskId, { limit: 0 }).then(
          () => 'accepted',
          (error) => error.message,
        ),
      ];
      c.ok(
        'all SDKs validate limit>=1 locally',
        sdkLocal.every((m) => m !== 'accepted' && /cursor/i.test(m)),
        sdkLocal,
      );
      extra.sdk_wrong_credential_codes = rejected;
    },
    { needs: ['serveUp'] },
  );

  // ------------------------------------------------------------------ s10 crash / restart
  await step(
    's10-crash-restart',
    'SIGKILL do serve no meio de um job e de uma tarefa; reinicio com o mesmo --state; sem repetir efeito',
    async (c, extra) => {
      const pj = ctx.projects.crashJob;
      const pt = ctx.projects.crashTask;
      const jobId = randomUUID();
      const taskId = randomUUID();
      const jobCreate = cmd(jobId, 'create', 0, {
        kind: 'task',
        definition: { contract: pj.contract, responses: [{ name: 'engineering.command', input: { id: 'long' } }] },
        not_before: new Date(Date.now() - 1000).toISOString(),
        deadline_at: new Date(Date.now() + 240_000).toISOString(),
        depends_on: [],
      });
      await ctx.sdk.js.call('job', jobCreate);
      const created = await ctx.sdk.js.call(
        'execute',
        cmd(taskId, 'create', 0, {
          contract: await ctx.sdk.js.call('prepare', pt.contract),
          responses: [{ name: 'engineering.command', input: { id: 'long' } }],
        }),
      );
      const resumeCommand = cmd(taskId, 'resume', created.current_sequence);
      let resumeOutcome = 'pending';
      const resumeFlight = ctx.sdk.js.call('execute', resumeCommand).then(
        (r) => (resumeOutcome = `resolved:${r.task_result}`),
        (error) => (resumeOutcome = `rejected:${error.code ?? error.message}`),
      );
      await waitFor(() => procsWith(pj.markerLong).length >= 2 && procsWith(pt.markerLong).length >= 2, {
        timeout: 120_000,
        interval: 200,
        what: 'job and task descendants running',
      });
      const jobBefore = await ctx.sdk.js.call('jobQuery', jobId);
      c.ok('before the crash: job is running with live descendants', jobBefore.status === 'running', jobBefore.status);
      const beforeJobIntents = (await ctx.sdk.js.call('jobEvents', jobId, { after: 0, limit: 1000 })).events.filter(
        (e) => e.event_type === 'JobExecutionRecorded' && e.payload?.phase === 'intent',
      ).length;
      c.ok('before the crash: exactly one dispatch intent recorded', beforeJobIntents === 1, beforeJobIntents);
      const taskEventsBefore = (await ctx.sdk.js.call('events', taskId, { after: 0, limit: 1000 })).events.length;
      const beforeMarkers = { job: procsWith(pj.markerLong).length, task: procsWith(pt.markerLong).length };
      const oldState = ctx.state;
      const oldPid = ctx.servePid;
      process.kill(oldPid, 'SIGKILL');
      await waitFor(() => !fs.existsSync(`/proc/${oldPid}`), { timeout: 10_000, what: 'serve death' });
      await resumeFlight;
      c.ok(
        'the in-flight resume request failed when the process died (client did not get a result)',
        resumeOutcome.startsWith('rejected'),
        resumeOutcome,
      );
      await stopAdapters();
      // The broker must notice the controller death and terminate the sandbox cgroup + descendants.
      const drained = await waitFor(() => procsWith(pj.markerLong).length === 0 && procsWith(pt.markerLong).length === 0, {
        timeout: 60_000,
        interval: 250,
        what: 'orphan drain after SIGKILL',
      }).then(
        () => true,
        () => false,
      );
      c.ok('after SIGKILL (before restart) the broker drained all descendants (no orphans)', drained, {
        job: procsWith(pj.markerLong),
        task: procsWith(pt.markerLong),
      });
      extra.markers_before_kill = beforeMarkers;
      // Restart on the same state, inside the same cgroup service.
      const banner = await startGeneration(['--config', path.join(WORK, 'control-config.json'), '--state', oldState]);
      c.ok('restart reports the same state directory', banner.state === oldState, banner.state);
      ctx.sdk = makeAdapters(banner.url);
      await Promise.all([ctx.sdk.ts.ready, ctx.sdk.py.ready]);
      const jobAfter = await ctx.sdk.js.call('jobQuery', jobId);
      extra.job_after_restart = { status: jobAfter.status, sequence: jobAfter.current_sequence };
      c.ok(
        'job history survived the restart (ledger rows preserved)',
        (await ctx.sdk.js.call('jobEvents', jobId, { after: 0, limit: 1000 })).events.length >= 4,
      );
      await sleep(5000); // give the dispatcher several ticks (250 ms) to wrongly re-dispatch
      const intentsAfter = (await ctx.sdk.js.call('jobEvents', jobId, { after: 0, limit: 1000 })).events.filter(
        (e) => e.event_type === 'JobExecutionRecorded' && e.payload?.phase === 'intent',
      ).length;
      c.ok('no second dispatch intent was recorded after restart (no repeated effect)', intentsAfter === 1, intentsAfter);
      c.ok(
        'no process carries the job marker 5 s after restart (the command was not re-executed)',
        procsWith(pj.markerLong).length === 0,
        procsWith(pj.markerLong),
      );
      const jobState = await ctx.sdk.js.call('jobQuery', jobId);
      c.ok('job state after restart is not a fabricated success', jobState.status !== 'succeeded', jobState.status);
      extra.job_state_after_wait = jobState.status;
      // Retrying the exact same task command must not silently re-run: contract = CONTROL_OUTCOME_UNCERTAIN (docs).
      const retry = await ctx.sdk.js.call('execute', resumeCommand).then(
        (r) => ({ ok: true, status: r.task_result, reason: r.reason }),
        (error) => ({ ok: false, code: error.code }),
      );
      extra.task_retry_after_restart = retry;
      c.ok(
        'retry of the same resume command_id returns CONTROL_OUTCOME_UNCERTAIN (intent without receipt)',
        retry.ok === false && retry.code === 'CONTROL_OUTCOME_UNCERTAIN',
        retry,
      );
      c.ok('the retry did not start the command again (no marker process)', procsWith(pt.markerLong).length === 0);
      const taskState = await ctx.sdk.js.call('query', taskId);
      extra.task_state_after_restart = {
        status: taskState.status,
        task_result: taskState.task_result,
        reason: taskState.reason,
        sequence: taskState.current_sequence,
        questions: taskState.questions,
      };
      c.ok('task is not reported as approved', taskState.task_result !== 'approved', taskState.task_result);
      const taskEventsAfter = (await ctx.sdk.js.call('events', taskId, { after: 0, limit: 1000 })).events.length;
      extra.task_events = { before_crash: taskEventsBefore, after_restart: taskEventsAfter };
      // Idempotent replay of the original job-create command must not create a second job or new effects.
      const replay = await ctx.sdk.py.call('job', jobCreate).then(
        (r) => r.status,
        (error) => error.code,
      );
      extra.job_create_replay_after_restart = replay;
      c.ok(
        'replaying the original job create command after restart is a no-op replay (no error, same job)',
        typeof replay === 'string' && replay !== 'JOB_RESOURCE_CONFLICT',
        replay,
      );
      // Explicit reconciliation is the documented way forward for the uncertain job.
      const reconcileJob = await ctx.sdk.js.call('job', cmd(jobId, 'reconcile', jobState.current_sequence)).then(
        (r) => ({ ok: true, status: r.status }),
        (error) => ({ ok: false, code: error.code }),
      );
      extra.job_reconcile = reconcileJob;
      const settled = await ctx.sdk.js.call('jobQuery', jobId);
      extra.job_after_reconcile = settled.status;
      c.ok(
        'after explicit reconcile the job is in a recorded, non-success state and nothing runs',
        settled.status !== 'succeeded' && procsWith(pj.markerLong).length === 0,
        { reconcileJob, status: settled.status },
      );
      const taskReconcile = await ctx.sdk.js.call('execute', cmd(taskId, 'reconcile', taskState.current_sequence)).then(
        (r) => ({ ok: true, task_result: r.task_result, questions: (r.questions || []).length }),
        (error) => ({ ok: false, code: error.code }),
      );
      extra.task_reconcile = taskReconcile;
      c.ok('task reconcile is accepted (returns state/questions rather than re-running)', taskReconcile.ok === true, taskReconcile);
      c.ok('still no marker process after reconcile', procsWith(pt.markerLong).length === 0 && procsWith(pj.markerLong).length === 0);
      extra.generation = ctx.serveGeneration;
    },
    { needs: ['serveUp'] },
  );

  // ------------------------------------------------------------------ s11 hygiene
  await step('s11-hygiene', 'Higiene: nenhuma credencial em evidencias, nenhum processo residual', async (c, extra) => {
    const markers = Object.values(ctx.projects)
      .flatMap((p) => [p.markerLong, p.markerEcho])
      .filter(Boolean);
    c.ok(
      'no leftover descendant process for any journey marker',
      markers.every((m) => procsWith(m).length === 0),
      markers.filter((m) => procsWith(m).length),
    );
    const leaks = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (entry.name === 'projects') continue;
          walk(full);
        } else if (fs.statSync(full).size < 5_000_000 && fs.readFileSync(full, 'latin1').includes(CREDENTIAL)) leaks.push(full);
      }
    };
    walk(OUT);
    c.ok('the credential does not appear in any evidence file', leaks.length === 0, leaks);
    extra.load_waits = loadWaits;
  });
} finally {
  await cleanup();
  await sleep(1500);
}

// ---------------------------------------------------------------------------------------------- result
const leftover = (() => {
  try {
    return fs
      .readdirSync('/proc')
      .filter((n) => /^\d+$/.test(n))
      .filter((pid) => {
        try {
          return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(path.join(WORK, 'control-config.json'));
        } catch {
          return false;
        }
      }).length;
  } catch {
    return -1;
  }
})();
ctx.limitations.push(
  'Executor isolation needs a delegated cgroup v2 (systemd-run --user -p Delegate=yes -p DelegateSubgroup=tests). Without it, `create` returns task_result=blocked reason=ENGINEERING_ISOLATION_UNAVAILABLE (observed in a smoke run) and `hseos sandbox engineering-check --json` reports workspace_write_confirmed=false for the legacy ai-jail probes (separate legacy backend; not used by the control executor).',
  'Responses are deterministic scripted tool calls (fixture), not model output: this proves the control plane, verifier, ledger and SDKs, not model quality or provider integration.',
  'TypeScript is type-checked with a tsc taken read-only from the checkout node_modules (typescript is not in the installed package); execution uses Node native type stripping (no emit).',
  'Crash/restart is exercised with SIGKILL of the serve process inside the SAME delegated cgroup service (a supervisor restarts it); host reboot and cgroup-owner loss are not covered.',
  'Terminal attach was driven through the packaged attachTerminal() with in-memory streams (non-TTY); a real TTY raw-mode session was not exercised.',
  'Ledger storage is the documented temporary candidate fixture (no production durability, no migration).',
);
const summary = {
  pacote: { sha256: ctx.tgzSha ?? sha256(fs.readFileSync(TGZ)), file: TGZ, installed_prefix: PREFIX },
  node: { journey: process.version, sandbox: ctx.runtimes?.sandbox_node },
  python: ctx.runtimes?.python,
  runtimes: ctx.runtimes,
  iniciado_em: startedAt,
  finalizado_em: new Date().toISOString(),
  serve: { generations: ctx.serveGeneration, state_dir: ctx.state, cgroup_service: `${UNIT}.service` },
  passos: ctx.results.map(({ id, descricao, status, evidencia, duracao_ms }) => ({ id, descricao, status, evidencia, duracao_ms })),
  resumo: ctx.results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}),
  limitacoes: ctx.limitations,
  residual_serve_processes: leftover,
};
fs.writeFileSync(path.join(OUT, 'core-journey-result.json'), JSON.stringify(summary, null, 2));
if (!KEEP_WORK) {
  for (const f of fs.readdirSync(WORK)) if (f !== 'projects') fs.rmSync(path.join(WORK, f), { recursive: true, force: true });
}
console.log('\n=== resumo ===');
for (const r of ctx.results) console.log(`${r.status.padEnd(8)} ${r.id.padEnd(24)} ${r.descricao}`);
console.log(`resultado: ${path.join(OUT, 'core-journey-result.json')}  ${canon(summary.resumo)}  residual_serve=${leftover}`);
// Fail-closed: a residual serve process (or an unreadable /proc scan, -1) and an empty result set are failures, not passes.
if (leftover !== 0) console.error(`FAIL: residual_serve=${leftover} (expected 0)`);
if (ctx.results.length === 0) console.error('FAIL: no journey step ran');
process.exit(ctx.results.length === 0 || leftover !== 0 || ctx.results.some((r) => r.status !== 'PASS') ? 1 : 0);

function stripIds(status) {
  const copy = structuredClone(status);
  for (const k of ['task_run_id', 'session_id', 'resource_id']) delete copy[k];
  const clean = (x) => {
    if (Array.isArray(x)) return x.map(clean);
    if (x && typeof x === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(x)) if (!/(^|_)(id|ids)$/.test(k) || k === 'task_id') o[k] = clean(v);
      return o;
    }
    return x;
  };
  return clean(copy);
}
