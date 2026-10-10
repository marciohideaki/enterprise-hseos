// A4 - installed-package MCP journey (4 HSEOS MCP servers).
// Usage: node test/journeys/mcp-journey.mjs --prefix <consumer project> --tgz <packed tarball> --out <dir> [--fail-on none|low|medium|high] [--axon-real optional|required]
// Fail-closed: exit 0 only when every call/negation is PASS, nothing aborted, no orphan process remains and
// no finding reaches --fail-on (default none = findings alone do not fail; FAIL/BLOCKED entries always do).
// --axon-real=optional (default; axon is an optional integration): when the axon binary is absent from PATH, the checks that need a
// real axon answer are reported NOT_EXERCISED (neither PASS nor BLOCKED) and recorded in the result; with axon on PATH they run and
// count normally. --axon-real=required turns an absent axon into BLOCKED. The AXON_UNAVAILABLE scenarios are mandatory in every mode.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const inline = argv.find((a) => a.startsWith(`--${k}=`));
  if (inline) return inline.slice(k.length + 3);
  const i = argv.indexOf(`--${k}`);
  return i === -1 ? d : argv[i + 1];
};
if (!opt('prefix') || !opt('tgz') || !opt('out')) {
  console.error('usage: mcp-journey.mjs --prefix <consumer project> --tgz <packed tarball> --out <dir>');
  process.exit(2);
}
const prefix = path.resolve(opt('prefix'));
const outDir = path.resolve(opt('out'));
const tgz = path.resolve(opt('tgz'));
const axonRealMode = opt('axon-real', 'optional');
if (!['optional', 'required'].includes(axonRealMode)) {
  console.error('--axon-real must be optional or required');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const pkgRoot = path.join(prefix, 'node_modules', 'hseos');
const SERVER = (d) => path.join(pkgRoot, 'tools', d, 'index.js');
const limitations = [];
const findings = [];
const spawned = [];
const cleanups = [];
const secrets = [];

const cleanEnv = { ...process.env };
delete cleanEnv.NODE_ENV;
delete cleanEnv.HSEOS_GOVERNED_EXECUTION_FIXTURE;
delete cleanEnv.HSEOS_STATE_DB;
delete cleanEnv.HSEOS_LEGACY_TELEMETRY_DB;

// ---------- environment / project ----------
const sha256 = createHash('sha256').update(fs.readFileSync(tgz)).digest('hex');
const projectSetup = { hseosInstall: 'not-needed' };
if (fs.existsSync(path.join(prefix, '.hseos'))) {
  projectSetup.hseosInstall = 'already installed (re-run)';
} else {
  const r = spawnSync(
    path.join(prefix, 'node_modules', '.bin', 'hseos'),
    ['install', '--directory', prefix, '--tools', 'none', '--yes', '--no-git-hooks'],
    { cwd: prefix, env: cleanEnv, input: '', encoding: 'utf8', timeout: 180_000 },
  );
  projectSetup.hseosInstall = r.status === 0 ? 'ran: hseos install --tools none --yes --no-git-hooks' : `FAILED rc=${r.status}`;
  if (r.status !== 0) limitations.push(`hseos install failed rc=${r.status}: ${(r.stderr || '').slice(0, 300)}`);
}

const axonOnPath = spawnSync('sh', ['-c', 'command -v axon'], { encoding: 'utf8' }).stdout.trim() || null;
// Real-axon checks are waived only when explicitly requested AND the binary is genuinely absent.
const axonRealWaived = axonRealMode === 'optional' && !axonOnPath;
const axonRealSkipped = [];
const axonRealUnavailable = (server, tool, args, reason) => {
  const entry = axonRealWaived
    ? {
        tool,
        args: truncate(args, 100),
        status: 'NOT_EXERCISED',
        evidence: `real axon not exercised (--axon-real=optional, axon not on PATH): ${reason}`,
      }
    : { tool, args: truncate(args, 100), status: 'BLOCKED', evidence: `a real answer cannot be obtained: ${reason}` };
  if (axonRealWaived) axonRealSkipped.push(`${server}:${tool}`);
  return entry;
};

function pgrep(pat) {
  const r = spawnSync('pgrep', ['-f', pat], { encoding: 'utf8' });
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map(Number)
    .filter((p) => p !== process.pid);
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- stdio client ----------
class StdioClient {
  constructor(script, extraArgs = [], env = cleanEnv, cwd = prefix) {
    this.child = spawn(process.execPath, [script, ...extraArgs], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    spawned.push(this.child.pid);
    this.buf = '';
    this.stderr = '';
    this.lines = [];
    this.badLines = [];
    this.waiters = new Map();
    this.exited = null;
    this.child.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          this.badLines.push(line);
          continue;
        }
        this.lines.push(m);
        const w = this.waiters.get(m.id);
        if (w) {
          this.waiters.delete(m.id);
          w(m);
        }
      }
    });
    this.child.stderr.on('data', (d) => {
      this.stderr += d;
    });
    this.child.on('exit', (code, sig) => {
      this.exited = { code, sig };
      for (const w of this.waiters.values()) w(null);
      this.waiters.clear();
    });
  }
  send(obj) {
    this.child.stdin.write(`${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n`);
  }
  async rpc(method, params, id, timeout = 8000) {
    const p = new Promise((res) => {
      this.waiters.set(id, res);
      setTimeout(() => {
        if (this.waiters.delete(id)) res('TIMEOUT');
      }, timeout);
    });
    this.send({ jsonrpc: '2.0', id, method, params });
    return p;
  }
  async close() {
    if (this.exited) return this.exited;
    this.child.stdin.end();
    await Promise.race([new Promise((r) => this.child.once('exit', r)), sleep(3000)]);
    if (!this.exited) {
      this.child.kill('SIGTERM');
      await Promise.race([new Promise((r) => this.child.once('exit', r)), sleep(3000)]);
    }
    if (!this.exited) {
      this.child.kill('SIGKILL');
      await sleep(300);
    }
    return this.exited;
  }
}

const truncate = (v, n = 400) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}...(+${s.length - n})` : s;
};
const toolPayload = (r) => {
  try {
    return JSON.parse(r.result.content[0].text);
  } catch {
    return r?.result;
  }
};

// Core locations reported next to a FAIL so the failure is actionable without re-reading the journey.
const WHERE = {
  'schema-violation': 'tools/lib/mcp-transport.js createArgumentValidator + tools/call branch (must answer -32602)',
  'wrong-type': 'tools/lib/mcp-transport.js createArgumentValidator (must answer -32602)',
  'enum-violation': 'tools/lib/mcp-transport.js createArgumentValidator (must answer -32602)',
  'missing-name': 'tools/lib/mcp-transport.js tools/call branch (must answer -32602)',
  'unknown-method': 'tools/lib/mcp-transport.js default branch (must answer -32601)',
  'non-object': 'tools/lib/mcp-transport.js createMessageHandler (must answer -32600 and stay alive)',
  'jsonrpc-notification': 'tools/lib/mcp-transport.js notification branch (must not reply)',
  'out-of-scope': 'tools/mcp-hseos-swarm/lib/run-scope.js resolveRunDir/assertFileInside (must error and not leak/write)',
  'nonexistent-entity': 'tools/mcp-project-state/index.js tasks_update case (must throw when no row changed)',
  'axon-unavailable': 'tools/mcp-axon-bridge/lib/axon-client.js unavailableError (must surface AXON_UNAVAILABLE)',
  'http-auth': 'tools/mcp-axon-bridge/index.js protectHttpServer',
};
const whereOf = (kind) => (kind && Object.entries(WHERE).find(([k]) => kind === k || kind.startsWith(k))?.[1]) || undefined;

const has = (v, needle) => String(JSON.stringify(v) ?? '').includes(needle);
const text = (resp) => String(JSON.stringify(resp) ?? '');

// Records one call. expect: 'ok' | 'denied'. judge: (resp,payload)=>[ok,note]. code: required JSON-RPC error code when denied.
function record(list, tool, args, resp, expect, judge, kind, code) {
  const entry = { tool, args: truncate(args, 200), status: 'FAIL', evidence: '' };
  if (kind) entry.kind = kind;
  if (resp === 'TIMEOUT' || resp === null) {
    entry.evidence = resp === null ? 'no response (process exited)' : 'timeout, no response';
  } else {
    const isErr = !!resp.error || resp.result?.isError === true;
    const payload = resp.error ? null : toolPayload(resp);
    if (expect === 'ok') {
      let ok = !isErr;
      let note = '';
      if (ok && judge) [ok, note] = judge(resp, payload);
      entry.status = ok ? 'PASS' : 'FAIL';
      entry.evidence =
        `${isErr ? `error ${resp.error?.code}: ${resp.error?.message}` : 'result'} ${truncate(payload ?? resp.error, 300)} ${note}`.trim();
    } else {
      let ok = isErr;
      let note = '';
      if (ok && code !== undefined && resp.error?.code !== code) {
        ok = false;
        note = ` (expected code ${code})`;
      }
      if (ok && judge) [ok, note] = judge(resp, payload);
      entry.status = ok ? 'PASS' : 'FAIL';
      entry.evidence = isErr
        ? `denied with JSON-RPC error code=${resp.error?.code} message=${truncate(resp.error?.message, 200)}${note}`
        : `NOT denied; result=${truncate(payload, 300)}`;
    }
  }
  if (entry.status === 'FAIL') entry.where = whereOf(kind);
  list.push(entry);
  return entry;
}

const push = (list, entry) => {
  if (entry.status === 'FAIL' && !entry.where) entry.where = whereOf(entry.kind);
  list.push(entry);
  return entry;
};

async function stdioHandshake(c, server) {
  const init = await c.rpc(
    'initialize',
    { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a4-journey', version: '0' } },
    1,
  );
  const ok = !!init?.result?.protocolVersion;
  server.initialize = init?.result
    ? { protocolVersion: init.result.protocolVersion, serverInfo: init.result.serverInfo, capabilities: init.result.capabilities }
    : truncate(init);
  push(server.chamadas, { tool: 'initialize', status: ok ? 'PASS' : 'FAIL', evidence: truncate(server.initialize, 200) });
  const before = c.lines.length;
  c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await sleep(250);
  const answered = c.lines.length > before;
  push(server.chamadas, {
    tool: 'notifications/initialized',
    status: answered ? 'FAIL' : 'PASS',
    evidence: answered ? `server replied to a notification: ${truncate(c.lines.slice(before), 200)}` : 'no reply (conformant)',
    kind: 'jsonrpc-notification',
  });
  const list = await c.rpc('tools/list', {}, 2);
  server.tools = (list?.result?.tools || []).map((t) => t.name);
  push(server.chamadas, {
    tool: 'tools/list',
    status: server.tools.length > 0 ? 'PASS' : 'FAIL',
    evidence: `${server.tools.length} tools: ${server.tools.join(',')}`,
  });
  return init;
}

// Negatives every server must satisfy, over a live stdio connection.
async function commonNegatives(c, server, validTool, badArgs, wrongTypeArgs) {
  let id = 100;
  record(
    server.negacoes,
    'unknown_tool_xyz',
    {},
    await c.rpc('tools/call', { name: 'unknown_tool_xyz', arguments: {} }, id++),
    'denied',
    null,
    'unknown-tool',
  );
  record(
    server.negacoes,
    'tools/call(no name)',
    {},
    await c.rpc('tools/call', { arguments: {} }, id++),
    'denied',
    null,
    'missing-name',
    -32_602,
  );
  record(server.negacoes, 'method unknown', {}, await c.rpc('nope/method', {}, id++), 'denied', null, 'unknown-method', -32_601);
  if (badArgs)
    record(
      server.negacoes,
      validTool,
      badArgs,
      await c.rpc('tools/call', { name: validTool, arguments: badArgs }, id++),
      'denied',
      null,
      'schema-violation',
      -32_602,
    );
  if (wrongTypeArgs)
    record(
      server.negacoes,
      validTool,
      wrongTypeArgs,
      await c.rpc('tools/call', { name: validTool, arguments: wrongTypeArgs }, id++),
      'denied',
      null,
      'wrong-type',
      -32_602,
    );
  // malformed JSON line
  let before = c.lines.length;
  c.send('{not json');
  await sleep(400);
  const parseErr = c.lines.slice(before).find((l) => l.error);
  push(server.negacoes, {
    tool: 'malformed-json-line',
    status: parseErr?.error?.code === -32_700 ? 'PASS' : 'FAIL',
    evidence: parseErr ? `error code=${parseErr.error.code}` : 'no parse-error response',
    kind: 'malformed-input',
  });
  // notification with unknown method must NOT be answered
  before = c.lines.length;
  c.send({ jsonrpc: '2.0', method: 'bogus/notification' });
  await sleep(400);
  const answered = c.lines.slice(before);
  push(server.negacoes, {
    tool: 'unknown-method-notification (no id)',
    status: answered.length === 0 ? 'PASS' : 'FAIL',
    evidence:
      answered.length === 0 ? 'discarded silently (JSON-RPC conformant)' : `server replied to a notification: ${truncate(answered, 200)}`,
    kind: 'jsonrpc-notification',
  });
  // valid JSON that is not a request object: -32600 and the server must survive
  for (const [label, line] of [
    ['null', 'null'],
    ['number', '42'],
    ['array', '[]'],
    ['string', '"x"'],
    ['object-without-method', '{"jsonrpc":"2.0","id":901}'],
    ['object-id-not-scalar', '{"jsonrpc":"2.0","id":{},"method":"tools/list"}'],
  ]) {
    before = c.lines.length;
    c.send(line);
    await sleep(350);
    const reply = c.lines.slice(before).find((l) => l.error);
    push(server.negacoes, {
      tool: `non-request:${label}`,
      status: !c.exited && reply?.error?.code === -32_600 ? 'PASS' : 'FAIL',
      evidence: c.exited
        ? `SERVER DIED exit=${JSON.stringify(c.exited)} stderr=${truncate(c.stderr.slice(-300), 300)}`
        : `reply=${truncate(reply ?? null, 150)}`,
      kind: 'non-object',
    });
    if (c.exited) return;
  }
  const still = await c.rpc('tools/list', {}, id++);
  push(server.negacoes, {
    tool: 'still-serving-after-non-requests',
    status: still?.result?.tools?.length > 0 ? 'PASS' : 'FAIL',
    evidence: still?.result ? `${still.result.tools.length} tools` : truncate(still, 100),
    kind: 'non-object',
  });
}

const servers = [];
const aborts = [];
const base = (nome, script, transporte) => ({
  nome,
  script: path.relative(prefix, script),
  caminho: null,
  transporte,
  tools: [],
  chamadas: [],
  negacoes: [],
  notas: [],
});

// legacy vs native detection: stderr banner of startLegacyMcpServer
const detectPath = (c) =>
  /legacy MCP compatibility/.test(c.stderr)
    ? 'legacy'
    : /native|governed/i.test(c.stderr)
      ? 'native'
      : `unknown (stderr: ${truncate(c.stderr, 120)})`;

async function finishStdio(s, c) {
  s.exit = await c.close();
  s.stderr = truncate(c.stderr, 400);
  s.stdoutNonJson = c.badLines.length;
  push(s.negacoes, {
    tool: '(stdout framing)',
    status: c.badLines.length === 0 ? 'PASS' : 'FAIL',
    evidence: c.badLines.length === 0 ? 'stdout carried only JSON-RPC lines' : `non-JSON stdout: ${truncate(c.badLines, 200)}`,
    kind: 'framing',
  });
}

// ============ 1. governance ============
async function runGovernance() {
  const s = base('hseos-governance', SERVER('mcp-hseos-governance'), 'stdio');
  servers.push(s);
  const c = new StdioClient(SERVER('mcp-hseos-governance'));
  await sleep(1200);
  s.caminho = detectPath(c);
  await stdioHandshake(c, s);
  const call = (name, args, id) => c.rpc('tools/call', { name, arguments: args }, id);
  record(
    s.chamadas,
    'query_constitution',
    { article: 'constitution' },
    await call('query_constitution', { article: 'constitution' }, 10),
    'ok',
    (r, p) => [!!(p && (p.text || p.files)) && !p.error, `path=${p?.path} len=${(p?.text || '').length}`],
  );
  record(
    s.chamadas,
    'check_authority',
    { agent_code: 'SWARM' },
    await call('check_authority', { agent_code: 'SWARM' }, 11),
    'ok',
    (r, p) => [!!p && !p.error && !!p.authority, `authority_len=${(p?.authority || '').length}`],
  );
  record(
    s.chamadas,
    'validate_adr',
    { change_kind: 'security' },
    await call('validate_adr', { change_kind: 'security' }, 12),
    'ok',
    (r, p) => [p?.required === true, `required=${p?.required}`],
  );
  record(s.chamadas, 'list_skills', {}, await call('list_skills', {}, 13), 'ok', (r, p) => [
    Array.isArray(p?.skills),
    `skills=${p?.skills?.length}`,
  ]);
  await commonNegatives(c, s, 'check_authority', {}, { agent_code: 12_345 });
  // out-of-scope: traversal in agent_code / article must not return file content (an error is also fine)
  const trav = await call('check_authority', { agent_code: '../../../../../../etc' }, 21);
  const tp = toolPayload(trav);
  push(s.negacoes, {
    tool: 'check_authority',
    args: '{"agent_code":"../../../../../../etc"}',
    kind: 'out-of-scope-path',
    status: trav?.error || (tp && !tp.authority && !tp.constraints) ? 'PASS' : 'FAIL',
    evidence: `no file content returned outside the package: ${truncate(trav?.error ?? tp, 200)}`,
  });
  const trav2 = await call('query_constitution', { article: '../../../../etc/passwd' }, 22);
  const tp2 = toolPayload(trav2);
  push(s.negacoes, {
    tool: 'query_constitution',
    args: '{"article":"../../../../etc/passwd"}',
    kind: 'out-of-scope-path',
    status: trav2?.error || (tp2 && !tp2.text && !has(tp2, 'root:')) ? 'PASS' : 'FAIL',
    evidence: truncate(trav2?.error ?? tp2, 200),
  });
  s.notas.push(`spec root is the installed package (${pkgRoot}); specs are bundled, so this is intended`);
  const tele = path.join(prefix, '.hseos', 'state', 'mcp-legacy-usage.db');
  s.notas.push(`legacy telemetry db written in consumer project: ${fs.existsSync(tele)} (${path.relative(prefix, tele)})`);
  await finishStdio(s, c);
}

// ============ 2. swarm ============
async function runSwarm() {
  const s = base('hseos-swarm', SERVER('mcp-hseos-swarm'), 'stdio');
  servers.push(s);
  const c = new StdioClient(SERVER('mcp-hseos-swarm'));
  await sleep(1200);
  s.caminho = detectPath(c);
  await stdioHandshake(c, s);
  const call = (name, args, id) => c.rpc('tools/call', { name, arguments: args }, id);
  const runsRoot = path.join(prefix, '.hseos', 'runs', 'dev-squad');
  fs.mkdirSync(runsRoot, { recursive: true });
  // canary in the project's own runs dir: swarm must see it (runs live in <cwd>/.hseos/runs/dev-squad)
  const projRun = path.join(runsRoot, 'a4-project-canary');
  fs.mkdirSync(projRun, { recursive: true });
  fs.writeFileSync(path.join(projRun, 'STATUS.md'), '# STATUS\n\n**Phase:** CANARY-PROJECT\n');
  cleanups.push(projRun);
  record(s.chamadas, 'list_runs', {}, await call('list_runs', {}, 10), 'ok', (r, p) => [
    has(p, 'a4-project-canary'),
    `runs=${p?.total}; sees consumer-project run canary=${has(p, 'a4-project-canary')}`,
  ]);
  const runId = `a4-journey-${Date.now()}`;
  const pl = await call('plan_squad', { batch_description: 'a4 journey probe', run_id: runId }, 11);
  const plp = toolPayload(pl);
  cleanups.push(path.join(runsRoot, runId));
  record(s.chamadas, 'plan_squad', { batch_description: 'a4 journey probe', run_id: runId }, pl, 'ok', () => {
    const expected = path.join(runsRoot, runId);
    const insideProject = !!plp?.run_dir && path.resolve(plp.run_dir) === expected && fs.existsSync(path.join(expected, 'PLAN.md'));
    return [insideProject && !plp.run_dir.includes('node_modules'), `run_dir=${plp?.run_dir} expected=${expected}`];
  });
  record(s.chamadas, 'get_run_state', { run_id: runId }, await call('get_run_state', { run_id: runId }, 12), 'ok', (r, p) => [
    !!p?.status,
    `status_len=${(p?.status || '').length}`,
  ]);
  record(s.chamadas, 'dispatch_wave', { run_id: runId }, await call('dispatch_wave', { run_id: runId }, 13), 'ok', (r, p) => [
    p && !p.error,
    truncate(p, 120),
  ]);
  const nodeModulesRuns = path.join(pkgRoot, '.hseos', 'runs');
  push(s.chamadas, {
    tool: '(no writes inside installed package)',
    status: fs.existsSync(nodeModulesRuns) ? 'FAIL' : 'PASS',
    evidence: fs.existsSync(nodeModulesRuns) ? `${nodeModulesRuns} exists` : 'node_modules/hseos/.hseos/runs absent',
    kind: 'out-of-scope-write',
  });
  await commonNegatives(c, s, 'plan_squad', {}, { batch_description: { a: 1 }, run_id: `a4-badtype-${Date.now()}` });
  // required field omitted must not create anything
  const norequiredId = `a4-norequired-${Date.now()}`;
  cleanups.push(path.join(runsRoot, norequiredId));
  record(
    s.negacoes,
    'plan_squad',
    { run_id: norequiredId },
    await call('plan_squad', { run_id: norequiredId }, 21),
    'denied',
    (r) => [!fs.existsSync(path.join(runsRoot, norequiredId)), 'nothing created on disk'],
    'schema-required-missing',
    -32_602,
  );

  // ---- out-of-scope: every escape must be an explicit error AND leak/write nothing
  const tag = `${process.pid}-${Date.now()}`;
  const readCanary = path.join(os.tmpdir(), `a4-outside-canary-${tag}`);
  fs.mkdirSync(readCanary, { recursive: true });
  fs.writeFileSync(path.join(readCanary, 'STATUS.md'), 'OUTSIDE-SECRET-STATUS-CANARY');
  fs.writeFileSync(path.join(readCanary, 'WAVE-1.md'), 'OUTSIDE-SECRET-WAVE-CANARY');
  fs.writeFileSync(path.join(readCanary, 'PLAN.md'), 'OUTSIDE-SECRET-PLAN-CANARY');
  const writeTarget = path.join(os.tmpdir(), `a4-outside-write-${tag}`);
  fs.mkdirSync(writeTarget, { recursive: true });
  cleanups.push(readCanary, writeTarget);
  const rel = (to) => path.relative(runsRoot, to);
  let id = 300;
  const escapeRead = async (label, tool, args) => {
    const resp = await call(tool, args, id++);
    const leaked = has(resp, 'OUTSIDE-SECRET');
    push(s.negacoes, {
      tool,
      args: truncate(args, 200),
      kind: `out-of-scope-read:${label}`,
      status: resp?.error && !leaked ? 'PASS' : 'FAIL',
      evidence: leaked
        ? `LEAK: outside canary returned (${truncate(resp, 160)})`
        : resp?.error
          ? `denied code=${resp.error.code} ${truncate(resp.error.message, 160)}`
          : `NOT an explicit error: ${truncate(resp, 200)}`,
    });
  };
  const escapeWrite = async (label, tool, args, probeFile) => {
    const resp = await call(tool, args, id++);
    const wrote = fs.existsSync(probeFile);
    push(s.negacoes, {
      tool,
      args: truncate(args, 200),
      kind: `out-of-scope-write:${label}`,
      status: resp?.error && !wrote ? 'PASS' : 'FAIL',
      evidence: wrote
        ? `WROTE ${probeFile}`
        : resp?.error
          ? `denied code=${resp.error.code} ${truncate(resp.error.message, 160)}`
          : `NOT an explicit error: ${truncate(resp, 200)}`,
    });
  };
  await escapeRead('relative-traversal', 'get_run_state', { run_id: rel(readCanary) });
  await escapeRead('absolute-path', 'get_run_state', { run_id: readCanary });
  await escapeRead('dotdot', 'get_run_state', { run_id: '..' });
  await escapeRead('relative-traversal', 'dispatch_wave', { run_id: rel(readCanary) });
  await escapeRead('relative-traversal', 'consolidate_handoff', { run_id: rel(readCanary), source_task: 'a', target_task: 'b' });
  await escapeRead('source_task-traversal', 'consolidate_handoff', { run_id: runId, source_task: '../../../../etc', target_task: 'b' });
  // symlinks inside the runs dir that point outside
  const linkDir = path.join(runsRoot, 'a4-link-dir');
  fs.symlinkSync(readCanary, linkDir);
  cleanups.push(linkDir);
  await escapeRead('symlinked-run-dir', 'get_run_state', { run_id: 'a4-link-dir' });
  const linkFileRun = path.join(runsRoot, 'a4-linkfile-run');
  fs.mkdirSync(linkFileRun, { recursive: true });
  fs.symlinkSync(path.join(readCanary, 'STATUS.md'), path.join(linkFileRun, 'STATUS.md'));
  fs.symlinkSync(path.join(readCanary, 'WAVE-1.md'), path.join(linkFileRun, 'WAVE-1.md'));
  cleanups.push(linkFileRun);
  await escapeRead('symlinked-file', 'get_run_state', { run_id: 'a4-linkfile-run' });
  const danglingLink = path.join(runsRoot, 'a4-dangling');
  fs.symlinkSync(path.join(os.tmpdir(), `a4-does-not-exist-${tag}`), danglingLink);
  cleanups.push(danglingLink);
  await escapeRead('dangling-symlink', 'get_run_state', { run_id: 'a4-dangling' });
  // writes
  await escapeWrite(
    'relative-traversal',
    'plan_squad',
    { batch_description: 'x', run_id: rel(writeTarget) },
    path.join(writeTarget, 'PLAN.md'),
  );
  await escapeWrite('absolute-path', 'plan_squad', { batch_description: 'x', run_id: writeTarget }, path.join(writeTarget, 'PLAN.md'));
  const linkW = path.join(runsRoot, 'a4-link-w');
  fs.symlinkSync(writeTarget, linkW);
  cleanups.push(linkW);
  await escapeWrite('symlinked-run-dir', 'plan_squad', { batch_description: 'x', run_id: 'a4-link-w' }, path.join(writeTarget, 'PLAN.md'));
  await finishStdio(s, c);
}

// ============ 3. project-state ============
async function runProjectState() {
  const s = base('hseos-project-state', SERVER('mcp-project-state'), 'stdio');
  servers.push(s);
  const c = new StdioClient(SERVER('mcp-project-state'));
  await sleep(2000);
  s.caminho = detectPath(c);
  await stdioHandshake(c, s);
  const call = (name, args, id) => c.rpc('tools/call', { name, arguments: args }, id);
  const mark = `a4-${Date.now()}`;
  record(
    s.chamadas,
    'state_write',
    { fields: { a4_marker: mark }, agent: 'a4' },
    await call('state_write', { fields: { a4_marker: mark }, agent: 'a4' }, 10),
    'ok',
    (r, p) => [p?.written === 1, `written=${p?.written}`],
  );
  record(s.chamadas, 'state_read', {}, await call('state_read', {}, 11), 'ok', (r, p) => [
    p?.state?.a4_marker === mark,
    `read-after-write marker match=${p?.state?.a4_marker === mark}`,
  ]);
  const tid = `a4-task-${Date.now()}`;
  record(
    s.chamadas,
    'tasks_add',
    { id: tid },
    await call('tasks_add', { id: tid, owner: 'a4', description: 'journey probe' }, 12),
    'ok',
    (r, p) => [p?.added === tid, ''],
  );
  record(s.chamadas, 'tasks_list', { status: 'pending' }, await call('tasks_list', { status: 'pending' }, 13), 'ok', (r, p) => [
    (p?.tasks || []).some((t) => t.id === tid),
    `count=${p?.count}`,
  ]);
  record(
    s.chamadas,
    'tasks_update',
    { id: tid, status: 'done' },
    await call('tasks_update', { id: tid, status: 'done' }, 14),
    'ok',
    (r, p) => [p?.updated === tid, ''],
  );
  record(s.chamadas, 'runs_list', {}, await call('runs_list', {}, 15), 'ok', (r, p) => [Array.isArray(p?.runs), `count=${p?.count}`]);
  record(s.chamadas, 'state_history', { n: 3 }, await call('state_history', { n: 3 }, 16), 'ok', (r, p) => [
    (p?.history || []).length > 0,
    `count=${p?.count}`,
  ]);
  await commonNegatives(c, s, 'tasks_add', { id: 'only-id' }, { id: 123, owner: 'a', description: 'b' });
  record(
    s.negacoes,
    'tasks_list',
    { status: 'bogus' },
    await call('tasks_list', { status: 'bogus' }, 20),
    'denied',
    null,
    'enum-violation',
    -32_602,
  );
  record(
    s.negacoes,
    'run_describe',
    { run_id: 'does-not-exist' },
    await call('run_describe', { run_id: 'does-not-exist' }, 21),
    'denied',
    null,
    'nonexistent-entity',
  );
  record(
    s.negacoes,
    'tasks_update',
    { id: 'no-such-task-a4', status: 'done' },
    await call('tasks_update', { id: 'no-such-task-a4', status: 'done' }, 22),
    'denied',
    null,
    'nonexistent-entity',
  );
  const dbp = path.join(prefix, '.hseos', 'state', 'project.db');
  push(s.chamadas, {
    tool: '(state db location)',
    status: fs.existsSync(dbp) ? 'PASS' : 'FAIL',
    evidence: `${path.relative(prefix, dbp)} exists=${fs.existsSync(dbp)}; legacy telemetry db: ${fs.existsSync(path.join(prefix, '.hseos', 'state', 'mcp-legacy-usage.db'))}`,
  });
  s.notas.push(
    'no tool of this server takes a filesystem path argument; the db path comes only from operator flag/env (--db / HSEOS_STATE_DB), so there is no client-reachable path scope to probe',
  );
  await finishStdio(s, c);
}

// ============ 4. axon-bridge: stdio (default), axon absent, HTTP with bearer ============
const AXON_TOOL_CALLS = [
  ['get_overview', {}],
  ['code_search', { query: 'mcp server', limit: 3 }],
];

// A real axon answer is a result without isError and without the removed fallback marker.
const realAxonAnswer = (resp) => {
  const p = toolPayload(resp || {});
  return !resp?.error && resp?.result?.isError !== true && p?.fallback !== true && p !== undefined;
};

// axon answers only for an indexed project: build a tiny fixture project (2 files) and index it once.
const axonFixture = path.join(outDir, 'axon-fixture');
function prepareAxonFixture() {
  fs.mkdirSync(axonFixture, { recursive: true });
  fs.writeFileSync(path.join(axonFixture, 'a.js'), 'function hello() { return 1; }\nmodule.exports = { hello };\n');
  fs.writeFileSync(
    path.join(axonFixture, 'b.js'),
    'const { hello } = require("./a");\nfunction run() { return hello(); }\nmodule.exports = { run };\n',
  );
  if (!axonOnPath) return { ok: false, reason: 'axon not on PATH' };
  const r = spawnSync('nice', ['-n', '10', axonOnPath, 'index', axonFixture], {
    cwd: axonFixture,
    env: cleanEnv,
    encoding: 'utf8',
    timeout: 180_000,
  });
  return {
    ok: r.status === 0,
    reason: r.status === 0 ? 'indexed' : `axon index exit=${r.status}: ${truncate((r.stderr || r.stdout || '').trim(), 200)}`,
  };
}
let axonFixtureState = null;

async function runAxonStdio() {
  const s = base('axon-bridge[stdio]', SERVER('mcp-axon-bridge'), 'stdio (default, no flags)');
  servers.push(s);
  axonFixtureState = prepareAxonFixture();
  const c = new StdioClient(SERVER('mcp-axon-bridge'), [], cleanEnv, axonFixture);
  await sleep(1500);
  s.caminho = detectPath(c);
  s.notas.push(`axon on PATH: ${axonOnPath}; fixture project ${axonFixture}: ${axonFixtureState.reason}`);
  await stdioHandshake(c, s);
  let id = 10;
  for (const [name, args] of AXON_TOOL_CALLS) {
    const resp = await c.rpc('tools/call', { name, arguments: args }, id++, 30_000);
    if (!axonOnPath || !axonFixtureState.ok) {
      push(s.chamadas, axonRealUnavailable(s.nome, name, args, axonFixtureState.reason));
      continue;
    }
    record(s.chamadas, name, args, resp, 'ok', () => [realAxonAnswer(resp), 'real axon answer (no fallback marker)']);
  }
  await commonNegatives(c, s, 'code_search', {}, { query: 123, limit: 'abc' });
  // out-of-scope path handed to axon: must not return the file contents
  const sk = await c.rpc(
    'tools/call',
    { name: 'get_skeleton', arguments: { files: ['/etc/passwd', '../../../../etc/shadow'] } },
    id++,
    30_000,
  );
  const leaked = has(sk, 'root:');
  push(s.negacoes, {
    tool: 'get_skeleton',
    args: '{"files":["/etc/passwd","../../../../etc/shadow"]}',
    kind: 'out-of-scope-path',
    status: leaked ? 'FAIL' : 'PASS',
    evidence: leaked ? `LEAK ${truncate(sk, 200)}` : `no /etc/passwd content returned: ${truncate(sk?.error ?? toolPayload(sk), 200)}`,
  });
  await finishStdio(s, c);
}

async function runAxonAbsent() {
  const s = base('axon-bridge[axon-absent]', SERVER('mcp-axon-bridge'), 'stdio, axon removed from PATH');
  servers.push(s);
  const env = { ...cleanEnv, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
  delete env.AXON_BIN;
  const probe = spawnSync('sh', ['-c', 'command -v axon'], { env, encoding: 'utf8' }).stdout.trim();
  const vendored = fs.existsSync(path.join(pkgRoot, 'tools', 'vendor', 'axon'));
  if (probe || vendored) {
    push(s.chamadas, {
      tool: '(setup)',
      status: 'BLOCKED',
      evidence: `cannot simulate an absent axon: found ${probe || 'vendored binary'}`,
    });
    return;
  }
  const c = new StdioClient(SERVER('mcp-axon-bridge'), [], env);
  await sleep(1500);
  s.caminho = detectPath(c);
  await stdioHandshake(c, s);
  let id = 10;
  for (const [name, args] of AXON_TOOL_CALLS) {
    const resp = await c.rpc('tools/call', { name, arguments: args }, id++, 15_000);
    push(s.negacoes, {
      tool: name,
      args: truncate(args, 100),
      kind: 'axon-unavailable',
      status: resp?.error && /AXON_UNAVAILABLE/.test(resp.error.message) && !has(resp, '"fallback":true') ? 'PASS' : 'FAIL',
      evidence: resp?.error
        ? `explicit error: ${truncate(resp.error.message, 200)}`
        : `NOT an explicit AXON_UNAVAILABLE error: ${truncate(resp, 200)}`,
    });
  }
  await finishStdio(s, c);
}

function httpRaw(port, { method = 'GET', pth = '/', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pth, headers, timeout: 30_000 }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          /* keep text */
        }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on('error', (error) => resolve({ status: 'ERR', json: null, text: String(error.message) }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function runAxonHttp() {
  const s = base('axon-bridge[http]', SERVER('mcp-axon-bridge'), 'http (--port=0) + bearer credential');
  servers.push(s);
  // 1. HTTP without / with a short credential must be refused at startup (fail-closed)
  for (const [label, cred] of [
    ['no credential', undefined],
    ['short credential (31 chars)', 'x'.repeat(31)],
  ]) {
    const env = { ...cleanEnv };
    delete env.HSEOS_AXON_BRIDGE_CREDENTIAL;
    if (cred) env.HSEOS_AXON_BRIDGE_CREDENTIAL = cred;
    const r = spawnSync(process.execPath, [SERVER('mcp-axon-bridge'), '--http', '--port=0'], {
      cwd: prefix,
      env,
      encoding: 'utf8',
      timeout: 15_000,
    });
    push(s.negacoes, {
      tool: `startup with ${label}`,
      kind: 'http-auth',
      status: r.status !== 0 && r.status !== null && /HSEOS_AXON_BRIDGE_CREDENTIAL/.test(r.stderr) ? 'PASS' : 'FAIL',
      evidence: `exit=${r.status} stderr=${truncate((r.stderr || '').trim(), 160)}`,
    });
  }
  // 2. start with a generated credential (never printed)
  const credential = crypto.randomBytes(24).toString('hex');
  secrets.push(credential);
  const env = { ...cleanEnv, HSEOS_AXON_BRIDGE_CREDENTIAL: credential };
  const c = new StdioClient(SERVER('mcp-axon-bridge'), ['--port=0'], env, axonFixture);
  await sleep(1800);
  s.caminho = detectPath(c);
  const port = c.stderr.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
  if (!port) {
    push(s.chamadas, {
      tool: '(startup)',
      status: 'FAIL',
      evidence: `no listening port in stderr: ${truncate(c.stderr, 200)} exit=${JSON.stringify(c.exited)}`,
    });
    await c.close();
    return;
  }
  push(s.negacoes, {
    tool: '(stdout framing)',
    status: c.badLines.length === 0 && c.lines.length === 0 ? 'PASS' : 'FAIL',
    evidence: 'HTTP mode must not write protocol or banner lines to stdout',
  });
  const auth = { authorization: `Bearer ${credential}`, 'content-type': 'application/json' };
  let rid = 1;
  const rpcH = async (method, params) =>
    (await httpRaw(port, { method: 'POST', headers: auth, body: { jsonrpc: '2.0', id: rid++, method, params } })).json;
  // unauthenticated / wrongly authenticated / browser-origin / foreign host must all be refused
  const rejects = [
    ['no Authorization header', { headers: { 'content-type': 'application/json' } }, 401],
    ['wrong bearer', { headers: { authorization: `Bearer ${'0'.repeat(48)}`, 'content-type': 'application/json' } }, 401],
    ['Basic scheme', { headers: { authorization: `Basic ${credential}` } }, 401],
    ['Origin header present', { headers: { ...auth, origin: 'http://evil.example' } }, 403],
    ['foreign Host header', { headers: { ...auth, host: 'evil.example:80' } }, 403],
  ];
  for (const [label, extra, expected] of rejects) {
    const r = await httpRaw(port, { method: 'POST', pth: '/', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, ...extra });
    push(s.negacoes, {
      tool: `HTTP ${label}`,
      kind: 'http-auth',
      status: r.status === expected && !has(r.json, '"tools"') ? 'PASS' : 'FAIL',
      evidence: `http ${r.status} (expected ${expected}) ${truncate(r.text, 100)}`,
    });
  }
  const unauthHealth = await httpRaw(port, { pth: '/health' });
  push(s.negacoes, {
    tool: 'HTTP GET /health without bearer',
    kind: 'http-auth',
    status: unauthHealth.status === 401 ? 'PASS' : 'FAIL',
    evidence: `http ${unauthHealth.status}`,
  });
  // authenticated functional path
  const health = await httpRaw(port, { pth: '/health', headers: { authorization: `Bearer ${credential}` } });
  push(s.chamadas, {
    tool: 'GET /health (bearer)',
    status: health.json?.status === 'ok' ? 'PASS' : 'FAIL',
    evidence: truncate(health.json ?? health.text, 300),
  });
  const init = await rpcH('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a4' } });
  s.initialize = init?.result ? { protocolVersion: init.result.protocolVersion, serverInfo: init.result.serverInfo } : init;
  push(s.chamadas, { tool: 'initialize', status: init?.result?.protocolVersion ? 'PASS' : 'FAIL', evidence: truncate(s.initialize, 200) });
  const tl = await rpcH('tools/list', {});
  s.tools = (tl?.result?.tools || []).map((t) => t.name);
  push(s.chamadas, { tool: 'tools/list', status: s.tools.length > 0 ? 'PASS' : 'FAIL', evidence: s.tools.join(',') });
  for (const [name, args] of AXON_TOOL_CALLS) {
    const resp = await rpcH('tools/call', { name, arguments: args });
    if (!axonOnPath || !axonFixtureState?.ok) push(s.chamadas, axonRealUnavailable(s.nome, name, args, axonFixtureState?.reason));
    else record(s.chamadas, name, args, resp, 'ok', () => [realAxonAnswer(resp), 'real axon answer (no fallback marker)']);
  }
  const notif = await httpRaw(port, { method: 'POST', headers: auth, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  push(s.chamadas, {
    tool: 'POST notification',
    status: notif.status === 202 && notif.text === '' ? 'PASS' : 'FAIL',
    evidence: `http ${notif.status}`,
    kind: 'jsonrpc-notification',
  });
  // negatives with a valid bearer
  record(
    s.negacoes,
    'unknown_tool_xyz',
    {},
    await rpcH('tools/call', { name: 'unknown_tool_xyz', arguments: {} }),
    'denied',
    null,
    'unknown-tool',
  );
  record(s.negacoes, 'tools/call(no name)', {}, await rpcH('tools/call', { arguments: {} }), 'denied', null, 'missing-name', -32_602);
  record(
    s.negacoes,
    'code_search',
    {},
    await rpcH('tools/call', { name: 'code_search', arguments: {} }),
    'denied',
    null,
    'schema-violation',
    -32_602,
  );
  record(
    s.negacoes,
    'code_search',
    { query: 123, limit: 'abc' },
    await rpcH('tools/call', { name: 'code_search', arguments: { query: 123, limit: 'abc' } }),
    'denied',
    null,
    'wrong-type',
    -32_602,
  );
  record(s.negacoes, 'nope/method', {}, await rpcH('nope/method', {}), 'denied', null, 'unknown-method', -32_601);
  const bad = await httpRaw(port, { method: 'POST', headers: auth, body: '{not json' });
  push(s.negacoes, {
    tool: 'HTTP malformed body',
    kind: 'malformed-input',
    status: bad.status === 400 && bad.json?.error?.code === -32_700 ? 'PASS' : 'FAIL',
    evidence: `http ${bad.status} ${truncate(bad.text, 120)}`,
  });
  const meth = await httpRaw(port, { pth: '/tools', headers: { authorization: `Bearer ${credential}` } });
  push(s.negacoes, {
    tool: 'HTTP GET /tools',
    kind: 'transport',
    status: meth.status === 405 ? 'PASS' : 'FAIL',
    evidence: `http ${meth.status}`,
  });
  for (const [label, body] of [
    ['null', 'null'],
    ['number', '42'],
    ['array', '[]'],
    ['string', '"x"'],
  ]) {
    const r = await httpRaw(port, { method: 'POST', headers: auth, body });
    push(s.negacoes, {
      tool: `HTTP body ${label}`,
      kind: 'non-object',
      status: r.json?.error?.code === -32_600 ? 'PASS' : 'FAIL',
      evidence: `http ${r.status} ${truncate(r.text, 120)}`,
    });
  }
  const sk = await rpcH('tools/call', { name: 'get_skeleton', arguments: { files: ['/etc/passwd'] } });
  push(s.negacoes, {
    tool: 'get_skeleton',
    args: '{"files":["/etc/passwd"]}',
    kind: 'out-of-scope-path',
    status: has(sk, 'root:') ? 'FAIL' : 'PASS',
    evidence: has(sk, 'root:') ? `LEAK ${truncate(sk, 200)}` : `no /etc/passwd content: ${truncate(sk?.error ?? toolPayload(sk), 160)}`,
  });
  const after = await httpRaw(port, { pth: '/health', headers: { authorization: `Bearer ${credential}` } });
  push(s.negacoes, {
    tool: '(still serving after non-object bodies)',
    kind: 'non-object',
    status: after.status === 200 ? 'PASS' : 'FAIL',
    evidence: `http ${after.status}`,
  });
  s.exit = await c.close();
  s.stderr = truncate(c.stderr, 400);
}

// ---------- main ----------
const load = os.loadavg()[0];
for (const [name, fn] of [
  ['governance', runGovernance],
  ['swarm', runSwarm],
  ['project-state', runProjectState],
  ['axon-bridge[stdio]', runAxonStdio],
  ['axon-bridge[axon-absent]', runAxonAbsent],
  ['axon-bridge[http]', runAxonHttp],
]) {
  try {
    await fn();
  } catch (error) {
    aborts.push({ stage: name, error: String(error.stack || error) });
    limitations.push(`journey stage "${name}" aborted by exception: ${error.stack}`);
  }
}
const EXPECTED_STAGES = 6;

// cleanup + orphan check (an orphan is a failure, not a warning)
for (const p of cleanups) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
await sleep(800);
const procCwd = (pid) => {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
};
const orphans = spawned.filter(alive);
// axon children spawned by the bridge inherit its cwd (consumer project or the axon fixture)
const axonOrphans = pgrep('axon serve').filter((p) => [prefix, axonFixture].includes(procCwd(p)));
const stray = pgrep(pkgRoot.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) + '/tools/mcp-');
const allOrphans = [...new Set([...orphans, ...axonOrphans, ...stray])];
for (const p of allOrphans) {
  try {
    process.kill(p, 'SIGKILL');
  } catch {
    /* gone */
  }
}

const aggregate = (s) => {
  const all = [...s.chamadas, ...s.negacoes];
  const cnt = (x) => all.filter((e) => e.status === x).length;
  return { PASS: cnt('PASS'), FAIL: cnt('FAIL'), BLOCKED: cnt('BLOCKED'), NOT_EXERCISED: cnt('NOT_EXERCISED') };
};
for (const s of servers) s.resumo = aggregate(s);
const totals = servers.reduce(
  (a, s) => ({
    PASS: a.PASS + s.resumo.PASS,
    FAIL: a.FAIL + s.resumo.FAIL,
    BLOCKED: a.BLOCKED + s.resumo.BLOCKED,
    NOT_EXERCISED: a.NOT_EXERCISED + s.resumo.NOT_EXERCISED,
  }),
  { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_EXERCISED: 0 },
);

const rank = { low: 1, medium: 2, high: 3 };
const failOn = opt('fail-on', 'none');
if (failOn !== 'none' && !rank[failOn]) {
  console.error('--fail-on must be none, low, medium or high');
  process.exit(2);
}
const reasons = [];
if (aborts.length > 0) reasons.push(`${aborts.length} stage(s) aborted: ${aborts.map((a) => a.stage).join(', ')}`);
if (servers.length < EXPECTED_STAGES) reasons.push(`only ${servers.length}/${EXPECTED_STAGES} server stages produced results`);
if (totals.FAIL > 0) reasons.push(`${totals.FAIL} FAIL`);
if (totals.BLOCKED > 0) reasons.push(`${totals.BLOCKED} BLOCKED`);
if (allOrphans.length > 0) reasons.push(`${allOrphans.length} orphan process(es): ${allOrphans.join(',')}`);
if (totals.PASS === 0) reasons.push('no PASS recorded');
if (failOn !== 'none' && findings.some((f) => (rank[f.severity] ?? 3) >= rank[failOn])) reasons.push(`finding at or above ${failOn}`);

const result = {
  gerado_em: new Date().toISOString(),
  veredito: reasons.length === 0 ? 'PASS' : 'FAIL',
  motivos_falha: reasons,
  axon_real: axonRealSkipped.length > 0 ? 'not_exercised' : 'exercised',
  axon_real_detalhe: {
    modo: axonRealMode,
    axon_no_path: axonOnPath,
    causa: axonRealSkipped.length > 0 ? 'axon is an optional integration and its binary is absent from PATH (--axon-real=optional)' : null,
    checagens_nao_exercitadas: axonRealSkipped,
  },
  pacote: { arquivo: tgz, sha256 },
  node: process.version,
  consumidor: { prefix, ...projectSetup, hseosVersion: JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version },
  axon_no_path: axonOnPath,
  load1_inicio: load,
  totais: totals,
  servidores: servers,
  achados: findings,
  abortos: aborts,
  processos: { spawned, orfaos_apos_encerrar: orphans, axon_orfaos: axonOrphans, strays_mortos_na_limpeza: stray },
  limitacoes: [
    ...limitations,
    'Servers were exercised only in the normal installed mode (NODE_ENV and HSEOS_GOVERNED_EXECUTION_FIXTURE unset), i.e. the legacy server path; the native governed path is fixture-gated and was not exercised here.',
    'axon-bridge is covered three ways: stdio (default), stdio with axon removed from PATH, and HTTP on an ephemeral 127.0.0.1 port with a generated bearer credential.',
    'Real axon answers depend on the axon binary found on PATH at run time; axon is optional, so without it those calls are reported NOT_EXERCISED (see axon_real in this file) and the verdict does not fail; with --axon-real=required they are BLOCKED and the journey fails. If axon is on PATH but cannot answer, the checks FAIL/BLOCK as usual.',
    'project-state has no client-reachable path argument, so out-of-scope path probes do not apply to it.',
  ],
};
let serialized = JSON.stringify(result, null, 2);
for (const secret of secrets) serialized = serialized.replaceAll(secret, '***');
fs.writeFileSync(path.join(outDir, 'mcp-journey-result.json'), serialized);
const line = (s) =>
  `${s.nome.padEnd(26)} ${String(s.caminho).padEnd(8)} tools=${String(s.tools.length).padEnd(3)} PASS=${s.resumo.PASS} FAIL=${s.resumo.FAIL} BLOCKED=${s.resumo.BLOCKED} NOT_EXERCISED=${s.resumo.NOT_EXERCISED}`;
console.log(servers.map(line).join('\n'));
console.log(
  `axon_real: ${result.axon_real}${axonRealSkipped.length > 0 ? ` (${axonRealSkipped.length} checks NOT_EXERCISED: axon optional and absent)` : ''}\nveredito: ${result.veredito}${reasons.length > 0 ? ` (${reasons.join('; ')})` : ''}; orphans: ${allOrphans.length}; out: ${path.join(outDir, 'mcp-journey-result.json')}`,
);
for (const s of servers)
  for (const e of [...s.chamadas, ...s.negacoes])
    if (e.status !== 'PASS')
      console.error(`  ${e.status} ${s.nome} ${e.tool} ${e.kind || ''} :: ${truncate(e.evidence, 200)}${e.where ? ` @ ${e.where}` : ''}`);
process.exit(reasons.length === 0 ? 0 : 1);
