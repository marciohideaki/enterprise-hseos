// A4 - installed-package MCP journey (4 HSEOS MCP servers).
// Usage: node test/journeys/mcp-journey.mjs --prefix <consumer project> --tgz <packed tarball> --out <dir> [--fail-on none|low|medium|high]
// Exit code is 0 unless --fail-on is given and a finding of at least that severity exists (default: none, report only).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const opt = (k, d) => {
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
fs.mkdirSync(outDir, { recursive: true });

const pkgRoot = path.join(prefix, 'node_modules', 'hseos');
const SERVER = (d) => path.join(pkgRoot, 'tools', d, 'index.js');
const limitations = [];
const findings = [];
const spawned = [];
const cleanups = [];

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
const axonProcsBefore = pgrep('axon mcp');

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
  constructor(script, extraArgs = []) {
    this.child = spawn(process.execPath, [script, ...extraArgs], { cwd: prefix, env: cleanEnv, stdio: ['pipe', 'pipe', 'pipe'] });
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

// Records one call. expect: 'ok' | 'denied'. judge(optional): (resp,payload)=>[bool,note]
function record(list, tool, args, resp, expect, judge, kind) {
  const entry = { tool, args: truncate(args, 200), status: 'FAIL', evidence: '' };
  if (resp === 'TIMEOUT' || resp === null) {
    entry.evidence = resp === null ? 'no response (process exited)' : 'timeout, no response';
    list.push(entry);
    return entry;
  }
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
    entry.status = isErr ? 'PASS' : 'FAIL';
    entry.evidence = isErr
      ? `denied with JSON-RPC error code=${resp.error?.code} message=${truncate(resp.error?.message, 200)}`
      : `NOT denied; result=${truncate(payload, 300)}`;
  }
  if (kind) entry.kind = kind;
  list.push(entry);
  return entry;
}

async function stdioHandshake(c, server) {
  const init = await c.rpc(
    'initialize',
    { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a4-journey', version: '0' } },
    1,
  );
  server.initialize = init?.result
    ? { protocolVersion: init.result.protocolVersion, serverInfo: init.result.serverInfo, capabilities: init.result.capabilities }
    : truncate(init);
  c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await sleep(250);
  const noReplyToNotif = !c.lines.some((l) => l.id === undefined || l.id === null);
  server.initializedNotificationAnswered = !noReplyToNotif;
  const list = await c.rpc('tools/list', {}, 2);
  server.tools = (list?.result?.tools || []).map((t) => t.name);
  server.toolSchemas = Object.fromEntries((list?.result?.tools || []).map((t) => [t.name, t.inputSchema]));
  return init;
}

// ---------- shared negative probes for stdio servers ----------
async function commonNegatives(c, server, validTool, validArgsMissingRequired) {
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
  record(server.negacoes, 'tools/call(no name)', {}, await c.rpc('tools/call', { arguments: {} }, id++), 'denied', null, 'missing-name');
  record(server.negacoes, 'method unknown', {}, await c.rpc('nope/method', {}, id++), 'denied', null, 'unknown-method');
  if (validArgsMissingRequired)
    record(
      server.negacoes,
      validTool,
      validArgsMissingRequired.args,
      await c.rpc('tools/call', { name: validTool, arguments: validArgsMissingRequired.args }, id++),
      'denied',
      null,
      'schema-violation',
    );
  // malformed JSON line
  const before = c.lines.length;
  c.send('{not json');
  await sleep(400);
  const parseErr = c.lines.slice(before).find((l) => l.error);
  server.negacoes.push({
    tool: 'malformed-json-line',
    status: parseErr?.error?.code === -32_700 ? 'PASS' : 'FAIL',
    evidence: parseErr ? `error code=${parseErr.error.code}` : 'no parse-error response',
    kind: 'malformed-input',
  });
  // notification with unknown method (must NOT be answered per JSON-RPC)
  const b2 = c.lines.length;
  c.send({ jsonrpc: '2.0', method: 'bogus/notification' });
  await sleep(400);
  const answered = c.lines.slice(b2);
  server.negacoes.push({
    tool: 'unknown-method-notification (no id)',
    status: answered.length === 0 ? 'PASS' : 'FAIL',
    evidence:
      answered.length === 0 ? 'ignored silently (JSON-RPC conformant)' : `server replied to a notification: ${truncate(answered, 200)}`,
    kind: 'jsonrpc-notification',
  });
  if (answered.length > 0)
    findings.push({
      id: `F-${server.nome}-notif-reply`,
      severity: 'low',
      server: server.nome,
      summary: 'unknown-method notification (no id) receives an error reply (JSON-RPC 2.0 forbids replies to notifications)',
      evidence: truncate(answered, 200),
      where: 'tools/lib/mcp-transport.js:105 (default branch builds error even when isNotification)',
    });
}

// crash probes run on a dedicated process; a crash is a finding
async function crashProbe(script, nome, args = []) {
  const res = [];
  let tail = '';
  for (const [label, line] of [
    ['JSON null', 'null'],
    ['JSON number', '42'],
    ['JSON array', '[]'],
    ['JSON string', '"x"'],
  ]) {
    const c = new StdioClient(script, args);
    await sleep(1200);
    c.send(line);
    await sleep(600);
    res.push({ probe: label, serverAlive: !c.exited, response: truncate(c.lines.at(-1) ?? null, 160), exit: c.exited });
    if (c.exited && !tail) tail = truncate(c.stderr.slice(-500), 500);
    await c.close();
  }
  return { probes: res, stderrTail: tail };
}

const servers = [];
const base = (nome, script) => ({
  nome,
  script: path.relative(prefix, script),
  caminho: null,
  transporte: null,
  tools: [],
  chamadas: [],
  negacoes: [],
  notas: [],
});

// legacy vs native detection: stderr banner of startLegacyMcpServer "legacy MCP compatibility stdio ready"
const detectPath = (c) =>
  /legacy MCP compatibility/.test(c.stderr)
    ? 'legacy'
    : /native|governed/i.test(c.stderr)
      ? 'native'
      : `unknown (stderr: ${truncate(c.stderr, 120)})`;

// ============ 1. governance ============
async function runGovernance() {
  const s = base('hseos-governance', SERVER('mcp-hseos-governance'));
  s.transporte = 'stdio';
  servers.push(s);
  const c = new StdioClient(SERVER('mcp-hseos-governance'));
  await sleep(1200);
  s.caminho = detectPath(c);
  await stdioHandshake(c, s);
  const insideSpec = (p) => p && p.path && p.path.startsWith(pkgRoot);
  record(
    s.chamadas,
    'query_constitution',
    { article: 'constitution' },
    await c.rpc('tools/call', { name: 'query_constitution', arguments: { article: 'constitution' } }, 10),
    'ok',
    (r, p) => [!!(p && (p.text || p.files)) && !p.error, `path=${p?.path} len=${(p?.text || '').length}`],
  );
  record(
    s.chamadas,
    'check_authority',
    { agent_code: 'SWARM' },
    await c.rpc('tools/call', { name: 'check_authority', arguments: { agent_code: 'SWARM' } }, 11),
    'ok',
    (r, p) => [!!p && !p.error && !!p.authority, `authority_len=${(p?.authority || '').length}`],
  );
  record(
    s.chamadas,
    'validate_adr',
    { change_kind: 'security' },
    await c.rpc('tools/call', { name: 'validate_adr', arguments: { change_kind: 'security' } }, 12),
    'ok',
    (r, p) => [p?.required === true, `required=${p?.required}`],
  );
  if (s.tools.includes('list_skills'))
    record(s.chamadas, 'list_skills', {}, await c.rpc('tools/call', { name: 'list_skills', arguments: {} }, 13), 'ok', (r, p) => [
      Array.isArray(p?.skills),
      `skills=${p?.skills?.length}`,
    ]);
  await commonNegatives(c, s, 'check_authority', { args: {} });
  // wrong type
  record(
    s.negacoes,
    'check_authority',
    { agent_code: 12_345 },
    await c.rpc('tools/call', { name: 'check_authority', arguments: { agent_code: 12_345 } }, 20),
    'denied',
    null,
    'wrong-type',
  );
  // scope: traversal in agent_code / article
  const trav = await c.rpc('tools/call', { name: 'check_authority', arguments: { agent_code: '../../../../../../etc' } }, 21);
  const tp = toolPayload(trav);
  s.negacoes.push({
    tool: 'check_authority',
    args: '{"agent_code":"../../../../../../etc"}',
    kind: 'out-of-scope-path',
    status: tp && !tp.authority && !tp.constraints ? 'PASS' : 'FAIL',
    evidence: `no file content returned outside package: ${truncate(tp, 200)}`,
  });
  const trav2 = await c.rpc('tools/call', { name: 'query_constitution', arguments: { article: '../../../../etc/passwd' } }, 22);
  const tp2 = toolPayload(trav2);
  s.negacoes.push({
    tool: 'query_constitution',
    args: '{"article":"../../../../etc/passwd"}',
    kind: 'out-of-scope-path',
    status: tp2 && !tp2.text ? 'PASS' : 'FAIL',
    evidence: truncate(tp2, 200),
  });
  s.notas.push(
    `spec root resolved to ${pkgRoot} (package, not consumer project): spec-reader REPO_ROOT = __dirname/../../.. (tools/mcp-hseos-governance/lib/spec-reader.js:8)`,
  );
  const tele = path.join(prefix, '.hseos', 'state', 'mcp-legacy-usage.db');
  s.notas.push(`legacy telemetry db written in consumer project: ${fs.existsSync(tele)} (${path.relative(prefix, tele)})`);
  s.exit = await c.close();
  s.stderr = truncate(c.stderr, 400);
  s.stdoutNonJson = c.badLines.length;
  s.crashProbe = await crashProbe(SERVER('mcp-hseos-governance'), s.nome);
}

// ============ 2. swarm ============
async function runSwarm() {
  const s = base('hseos-swarm', SERVER('mcp-hseos-swarm'));
  s.transporte = 'stdio';
  servers.push(s);
  const c = new StdioClient(SERVER('mcp-hseos-swarm'));
  await sleep(1200);
  s.caminho = detectPath(c);
  await stdioHandshake(c, s);
  // canary in the project's own .hseos/runs (what a user would expect swarm to see)
  const projRun = path.join(prefix, '.hseos', 'runs', 'dev-squad', 'a4-project-canary');
  fs.mkdirSync(projRun, { recursive: true });
  fs.writeFileSync(path.join(projRun, 'STATUS.md'), '# STATUS\n\n**Phase:** CANARY-PROJECT\n');
  const lr = await c.rpc('tools/call', { name: 'list_runs', arguments: {} }, 10);
  const lrp = toolPayload(lr);
  const seesProjectRun = JSON.stringify(lrp).includes('a4-project-canary');
  record(s.chamadas, 'list_runs', {}, lr, 'ok', () => [true, `runs=${lrp?.total}; sees consumer-project run canary=${seesProjectRun}`]);
  if (!seesProjectRun) {
    findings.push({
      id: 'F-swarm-root',
      severity: 'medium',
      server: s.nome,
      summary:
        'swarm tools resolve runs dir relative to the installed package (node_modules/hseos/.hseos/runs/dev-squad), not the consumer project cwd; a project run in <project>/.hseos/runs is invisible and plan_squad writes into node_modules',
      evidence: `list_runs did not list ${path.relative(prefix, projRun)}; payload=${truncate(lrp, 200)}`,
      where:
        'tools/mcp-hseos-swarm/tools/list_runs.js:7-8 (REPO_ROOT=__dirname/../../..), plan_squad.js:7, get_run_state.js:7, dispatch_wave.js:7, consolidate_handoff.js:7',
    });
  }
  const runId = `a4-journey-${Date.now()}`;
  const pl = await c.rpc('tools/call', { name: 'plan_squad', arguments: { batch_description: 'a4 journey probe', run_id: runId } }, 11);
  const plp = toolPayload(pl);
  record(s.chamadas, 'plan_squad', { batch_description: 'a4 journey probe', run_id: runId }, pl, 'ok', () => [
    !!plp?.run_dir,
    `run_dir=${plp?.run_dir}`,
  ]);
  if (plp?.run_dir) {
    cleanups.push(plp.run_dir);
    s.notas.push(
      `plan_squad run_dir inside consumer project tree (excluding node_modules): ${plp.run_dir.startsWith(prefix) && !plp.run_dir.includes('node_modules')}; inside node_modules: ${plp.run_dir.includes('node_modules')}`,
    );
  }
  record(
    s.chamadas,
    'get_run_state',
    { run_id: runId },
    await c.rpc('tools/call', { name: 'get_run_state', arguments: { run_id: runId } }, 12),
    'ok',
    (r, p) => [!!p?.status, `status_len=${(p?.status || '').length}`],
  );
  await commonNegatives(c, s, 'plan_squad', { args: {} });
  // schema: batch_description wrong type should be denied
  record(
    s.negacoes,
    'plan_squad',
    { batch_description: 123, run_id: 'x' },
    await c.rpc('tools/call', { name: 'plan_squad', arguments: { batch_description: { a: 1 }, run_id: `a4-badtype-${Date.now()}` } }, 20),
    'denied',
    null,
    'wrong-type',
  );
  // missing required: confirm whether it created something
  const bad = await c.rpc('tools/call', { name: 'plan_squad', arguments: { run_id: `a4-norequired-${Date.now()}` } }, 21);
  const badp = toolPayload(bad);
  if (badp?.run_dir) cleanups.push(badp.run_dir);
  s.negacoes.push({
    tool: 'plan_squad',
    args: '{run_id only, batch_description (required) omitted}',
    kind: 'schema-required-missing',
    status: bad?.error ? 'PASS' : 'FAIL',
    evidence: bad?.error
      ? `denied ${bad.error.message}`
      : `ACCEPTED, created ${badp?.run_dir}; plan_md has "Description: ${(badp?.plan_md || '').match(/Description:\*\* (.*)/)?.[1]}"`,
  });
  if (!bad?.error)
    findings.push({
      id: 'F-swarm-no-schema-validation',
      severity: 'medium',
      server: s.nome,
      summary:
        'tools/call does not validate arguments against the advertised inputSchema (required/types); plan_squad without required batch_description (and with object as description) creates a run on disk',
      evidence: truncate(badp, 200),
      where:
        'tools/lib/mcp-transport.js:98 (callTool called with params.arguments unvalidated); tools/mcp-hseos-swarm/tools/plan_squad.js:44-62',
    });
  // out-of-scope path: run_id traversal (read)
  const canary = path.join(os.tmpdir(), `a4-outside-canary-${process.pid}`);
  fs.mkdirSync(canary, { recursive: true });
  fs.writeFileSync(path.join(canary, 'STATUS.md'), 'OUTSIDE-SECRET-STATUS-CANARY');
  fs.writeFileSync(path.join(canary, 'WAVE-1.md'), 'OUTSIDE-SECRET-WAVE-CANARY');
  cleanups.push(canary);
  const runsDir = path.join(pkgRoot, '.hseos', 'runs', 'dev-squad');
  const rel = path.relative(runsDir, canary);
  const rd = await c.rpc('tools/call', { name: 'get_run_state', arguments: { run_id: rel } }, 30);
  const rdp = toolPayload(rd);
  const leaked = JSON.stringify(rdp).includes('OUTSIDE-SECRET');
  s.negacoes.push({
    tool: 'get_run_state',
    args: `{"run_id":"${rel}"}`,
    kind: 'out-of-scope-path-read',
    status: leaked ? 'FAIL' : 'PASS',
    evidence: leaked ? `READ OUTSIDE PACKAGE/PROJECT: returned content of ${canary} (${truncate(rdp, 160)})` : truncate(rdp, 200),
  });
  if (leaked)
    findings.push({
      id: 'F-swarm-traversal-read',
      severity: 'high',
      server: s.nome,
      summary: 'get_run_state accepts path traversal in run_id and returns STATUS.md and WAVE-*.md from any readable directory',
      evidence: `run_id=${rel} -> content canary returned`,
      where: 'tools/mcp-hseos-swarm/tools/get_run_state.js:21-33 (path.join(RUNS_DIR, args.run_id) no containment check)',
    });
  // out-of-scope path: run_id traversal (write)
  const wr = path.join(os.tmpdir(), `a4-outside-write-${process.pid}`);
  cleanups.push(wr);
  const wrel = path.relative(runsDir, wr);
  const wres = await c.rpc(
    'tools/call',
    { name: 'plan_squad', arguments: { batch_description: 'traversal-write-probe', run_id: wrel } },
    31,
  );
  const wrote = fs.existsSync(path.join(wr, 'PLAN.md'));
  s.negacoes.push({
    tool: 'plan_squad',
    args: `{"run_id":"${wrel}"}`,
    kind: 'out-of-scope-path-write',
    status: wrote ? 'FAIL' : 'PASS',
    evidence: wrote ? `WROTE PLAN.md/STATUS.md outside package: ${wr}` : truncate(toolPayload(wres) ?? wres?.error, 200),
  });
  if (wrote)
    findings.push({
      id: 'F-swarm-traversal-write',
      severity: 'high',
      server: s.nome,
      summary:
        'plan_squad accepts path traversal in run_id and creates directories/files (PLAN.md, STATUS.md) at an arbitrary writable location',
      evidence: `run_id=${wrel} -> ${wr}/PLAN.md created`,
      where:
        'tools/mcp-hseos-swarm/tools/plan_squad.js:53-61 (mkdirSync/writeFileSync on path.join(RUNS_DIR, run_id), no containment check)',
    });
  s.exit = await c.close();
  s.stderr = truncate(c.stderr, 400);
  s.stdoutNonJson = c.badLines.length;
  fs.rmSync(projRun, { recursive: true, force: true });
  s.crashProbe = await crashProbe(SERVER('mcp-hseos-swarm'), s.nome);
}

// ============ 3. project-state ============
async function runProjectState() {
  const s = base('hseos-project-state', SERVER('mcp-project-state'));
  s.transporte = 'stdio';
  servers.push(s);
  const c = new StdioClient(SERVER('mcp-project-state'));
  await sleep(2000);
  s.caminho = detectPath(c);
  await stdioHandshake(c, s);
  const mark = `a4-${Date.now()}`;
  record(
    s.chamadas,
    'state_write',
    { fields: { a4_marker: mark }, agent: 'a4' },
    await c.rpc('tools/call', { name: 'state_write', arguments: { fields: { a4_marker: mark }, agent: 'a4' } }, 10),
    'ok',
    (r, p) => [p?.written === 1, `written=${p?.written}`],
  );
  record(s.chamadas, 'state_read', {}, await c.rpc('tools/call', { name: 'state_read', arguments: {} }, 11), 'ok', (r, p) => [
    p?.state?.a4_marker === mark,
    `read-after-write marker match=${p?.state?.a4_marker === mark}`,
  ]);
  const tid = `a4-task-${Date.now()}`;
  record(
    s.chamadas,
    'tasks_add',
    { id: tid },
    await c.rpc('tools/call', { name: 'tasks_add', arguments: { id: tid, owner: 'a4', description: 'journey probe' } }, 12),
    'ok',
    (r, p) => [p?.added === tid, ''],
  );
  record(
    s.chamadas,
    'tasks_list',
    { status: 'pending' },
    await c.rpc('tools/call', { name: 'tasks_list', arguments: { status: 'pending' } }, 13),
    'ok',
    (r, p) => [(p?.tasks || []).some((t) => t.id === tid), `count=${p?.count}`],
  );
  record(s.chamadas, 'runs_list', {}, await c.rpc('tools/call', { name: 'runs_list', arguments: {} }, 14), 'ok', (r, p) => [
    Array.isArray(p?.runs),
    `count=${p?.count}`,
  ]);
  record(
    s.chamadas,
    'state_history',
    { n: 3 },
    await c.rpc('tools/call', { name: 'state_history', arguments: { n: 3 } }, 15),
    'ok',
    (r, p) => [(p?.history || []).length > 0, `count=${p?.count}`],
  );
  await commonNegatives(c, s, 'tasks_add', { args: { id: 'only-id' } });
  record(
    s.negacoes,
    'tasks_list',
    { status: 'bogus' },
    await c.rpc('tools/call', { name: 'tasks_list', arguments: { status: 'bogus' } }, 20),
    'denied',
    null,
    'enum-violation',
  );
  record(
    s.negacoes,
    'run_describe',
    { run_id: 'does-not-exist' },
    await c.rpc('tools/call', { name: 'run_describe', arguments: { run_id: 'does-not-exist' } }, 21),
    'denied',
    null,
    'nonexistent-entity',
  );
  const upd = await c.rpc('tools/call', { name: 'tasks_update', arguments: { id: 'no-such-task-a4', status: 'done' } }, 22);
  s.negacoes.push({
    tool: 'tasks_update',
    args: '{"id":"no-such-task-a4","status":"done"}',
    kind: 'nonexistent-entity',
    status: upd?.error ? 'PASS' : 'FAIL',
    evidence: upd?.error
      ? `denied ${upd.error.message}`
      : `reported success for a task that does not exist: ${truncate(toolPayload(upd), 150)}`,
  });
  if (!upd?.error)
    findings.push({
      id: 'F-state-update-ghost',
      severity: 'low',
      server: s.nome,
      summary:
        'tasks_update returns success for a nonexistent task id (UPDATE affects 0 rows, not checked); also status not validated against enum',
      evidence: truncate(toolPayload(upd), 150),
      where: 'tools/mcp-project-state/index.js:~118-124 (tasks_update case)',
    });
  // scope: db path override via env is operator-controlled; check the DB landed inside the project
  const dbp = path.join(prefix, '.hseos', 'state', 'project.db');
  s.notas.push(
    `state db at project cwd: ${fs.existsSync(dbp)} (${path.relative(prefix, dbp)}); legacy telemetry db: ${fs.existsSync(path.join(prefix, '.hseos', 'state', 'mcp-legacy-usage.db'))}`,
  );
  s.negacoes.push({
    tool: '(scope)',
    kind: 'out-of-scope-path',
    status: 'BLOCKED',
    evidence:
      'no tool of this server takes a filesystem path argument; db path comes only from operator flag/env (--db / HSEOS_STATE_DB), not from the MCP client',
  });
  s.exit = await c.close();
  s.stderr = truncate(c.stderr, 400);
  s.stdoutNonJson = c.badLines.length;
  s.crashProbe = await crashProbe(SERVER('mcp-project-state'), s.nome);
}

// ============ 4. axon-bridge (HTTP-only) ============
async function httpJson(port, method, pth, body) {
  const res = await fetch(`http://127.0.0.1:${port}${pth}`, {
    method,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, json, text };
}

async function runAxonBridge() {
  const s = base('axon-bridge', SERVER('mcp-axon-bridge'));
  s.transporte = 'http-only (no stdio mode in index.js)';
  servers.push(s);
  // 4a. stdio attempt: the entrypoint has mode:'http' hard-coded
  const sc = new StdioClient(SERVER('mcp-axon-bridge'), ['--port=0']);
  await sleep(1500);
  const initTry = await sc.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a4' } }, 1, 2500);
  s.stdioAttempt = { respondedOverStdio: !!initTry && initTry !== 'TIMEOUT', stdoutLines: truncate([...sc.lines, ...sc.badLines], 250) };
  const m = (sc.buf + sc.badLines.join('\n') + JSON.stringify(sc.lines) + sc.stderr).match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
  const stdoutAll = sc.badLines.join('\n');
  const port = (stdoutAll + sc.stderr).match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
  s.caminho = /legacy MCP compatibility/.test(stdoutAll + sc.stderr) ? 'legacy' : 'unknown';
  s.notas.push(
    `axon on PATH: ${axonOnPath}; startup banner: ${truncate(stdoutAll, 200)}`,
    'banner logs go to stdout (console.log) in bridge, unlike the other 3 servers which log to stderr; irrelevant to HTTP but would corrupt stdio framing',
  );
  if (!port) {
    s.chamadas.push({
      tool: '(startup)',
      status: 'FAIL',
      evidence: `could not find listening port in output; exit=${JSON.stringify(sc.exited)}`,
    });
    await sc.close();
    return;
  }
  let rid = 1;
  const rpcH = async (method, params) => (await httpJson(port, 'POST', '/', { jsonrpc: '2.0', id: rid++, method, params })).json;
  const health = await httpJson(port, 'GET', '/health');
  s.chamadas.push({
    tool: 'GET /health',
    status: health.json?.status === 'ok' ? 'PASS' : 'FAIL',
    evidence: truncate(health.json ?? health.text, 300),
  });
  const init = await rpcH('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a4' } });
  s.initialize = init?.result
    ? { protocolVersion: init.result.protocolVersion, serverInfo: init.result.serverInfo, capabilities: init.result.capabilities }
    : init;
  const tl = await rpcH('tools/list', {});
  s.tools = (tl?.result?.tools || []).map((t) => t.name);
  // valid calls: classify honestly; fallback:true => not functional success
  const classify = (tool, args, resp) => {
    const p = toolPayload(resp || {});
    const fb = p?.fallback === true;
    let status;
    let note;
    if (resp?.error) {
      status = 'FAIL';
      note = `error ${resp.error.message}`;
    } else if (fb) {
      status = axonOnPath ? 'FAIL' : 'BLOCKED';
      note = axonOnPath
        ? 'noOpResponse fallback although axon is on PATH (bridge did not obtain a real answer from axon; degraded silently)'
        : 'noOpResponse fallback because axon is absent';
    } else {
      status = 'PASS';
      note = 'real axon answer';
    }
    s.chamadas.push({ tool, args: truncate(args, 150), status, evidence: `${note}: ${truncate(p, 300)}`, fallback: fb });
    return { fb, p };
  };
  const axProbe = axonOnPath ? spawnSync(axonOnPath, ['mcp'], { input: '{}\n', encoding: 'utf8', timeout: 15_000, cwd: prefix }) : null;
  s.axonMcpSubcommandProbe = axProbe
    ? {
        status: axProbe.status,
        outputHead: truncate(((axProbe.stdout || '') + (axProbe.stderr || '')).trim().split('\n').slice(0, 2).join(' | '), 200),
        version: spawnSync(axonOnPath, ['--version'], { encoding: 'utf8' }).stdout.trim(),
      }
    : null;
  const g = await rpcH('tools/call', { name: 'get_overview', arguments: {} });
  const r1 = classify('get_overview', {}, g);
  const cs = await rpcH('tools/call', { name: 'code_search', arguments: { query: 'mcp server', limit: 3 } });
  const r2 = classify('code_search', { query: 'mcp server', limit: 3 }, cs);
  if (r1.fb && axonOnPath)
    findings.push({
      id: 'F-axon-bridge-fallback-with-binary',
      severity: 'medium',
      server: s.nome,
      summary: `with axon on PATH (${s.axonMcpSubcommandProbe?.version}) bridge tools still return noOpResponse (fallback:true). Root cause observed: bridge spawns \`axon mcp\` but that is not a subcommand of this axon (prints usage; real command is \`axon serve\`), and the bridge also sends tools/call without an initialize handshake using tool names mcp__axon__*. The failure reason is swallowed and indistinguishable to the client from "axon not installed" (the reason text always says "axon binary not found")`,
      evidence: truncate(r1.p, 250),
      where:
        "tools/mcp-axon-bridge/lib/axon-client.js:11,20,38,49,60,70 (all failure paths -> noOpResponse; spawn(binaryPath, ['mcp']) at :17, request w/o initialize at :25); no-op-fallback.js:6 reason string always says binary not found",
    });
  // negatives over HTTP
  const neg = (tool, args, kind, resp, expectDenied = true) => {
    const denied = !!resp?.error || resp?.result?.isError === true;
    s.negacoes.push({
      tool,
      args: truncate(args, 150),
      kind,
      status: denied === expectDenied ? 'PASS' : 'FAIL',
      evidence: denied ? `denied code=${resp.error?.code} ${truncate(resp.error?.message, 160)}` : `NOT denied: ${truncate(resp, 250)}`,
    });
    return denied;
  };
  neg('unknown_tool_xyz', {}, 'unknown-tool', await rpcH('tools/call', { name: 'unknown_tool_xyz', arguments: {} }));
  neg('tools/call(no name)', {}, 'missing-name', await rpcH('tools/call', { arguments: {} }));
  neg('code_search', {}, 'schema-required-missing', await rpcH('tools/call', { name: 'code_search', arguments: {} }));
  neg(
    'code_search',
    { query: 123 },
    'wrong-type',
    await rpcH('tools/call', { name: 'code_search', arguments: { query: 123, limit: 'abc' } }),
  );
  neg('nope/method', {}, 'unknown-method', await rpcH('nope/method', {}));
  // out-of-scope path: get_skeleton on /etc/passwd
  const sk = await rpcH('tools/call', { name: 'get_skeleton', arguments: { files: ['/etc/passwd', '../../../../etc/shadow'] } });
  const skp = toolPayload(sk || {});
  const leakedPw = JSON.stringify(skp).includes('root:');
  s.negacoes.push({
    tool: 'get_skeleton',
    args: '{"files":["/etc/passwd","../../../../etc/shadow"]}',
    kind: 'out-of-scope-path',
    status: leakedPw ? 'FAIL' : skp?.fallback ? 'BLOCKED' : 'PASS',
    evidence: leakedPw
      ? `LEAK ${truncate(skp, 200)}`
      : `no passwd content returned. ${skp?.fallback ? 'NOTE: result was noOp fallback, so axon path containment itself was NOT exercised' : ''} ${truncate(skp, 200)}`,
  });
  // transport-level
  const bad = await httpJson(port, 'POST', '/', '{not json');
  s.negacoes.push({
    tool: 'HTTP malformed body',
    kind: 'malformed-input',
    status: bad.status === 400 && bad.json?.error?.code === -32_700 ? 'PASS' : 'FAIL',
    evidence: `http ${bad.status} ${truncate(bad.text, 120)}`,
  });
  const meth = await httpJson(port, 'GET', '/tools');
  s.negacoes.push({
    tool: 'HTTP GET /tools',
    kind: 'transport',
    status: meth.status === 405 ? 'PASS' : 'FAIL',
    evidence: `http ${meth.status}`,
  });
  const nullBody = await httpJson(port, 'POST', '/', 'null').catch((error) => ({ status: 'ERR', text: String(error) }));
  const alive2 = await httpJson(port, 'GET', '/health')
    .then((r) => r.status === 200)
    .catch(() => false);
  s.negacoes.push({
    tool: 'HTTP body "null"',
    kind: 'malformed-input',
    status: alive2 && nullBody.status !== 'ERR' && nullBody.json?.error ? 'PASS' : 'FAIL',
    evidence: `http ${nullBody.status} ${truncate(nullBody.text, 120)}; server alive after=${alive2}`,
  });
  if (!alive2)
    findings.push({
      id: 'F-axon-bridge-crash-null-body',
      severity: 'medium',
      server: s.nome,
      summary:
        'HTTP POST with body `null` (valid JSON, not an object) crashes the whole axon-bridge process (unhandled rejection in the async req.end handler); subsequent /health fails',
      evidence: `fetch after: ${truncate(nullBody.text, 100)}; alive=${alive2}`,
      where: 'tools/lib/mcp-transport.js:46 (await handleMessage in async end handler, no try/catch) -> :78 destructure of null',
    });
  s.notas.push('auth: HTTP listener binds 127.0.0.1 only; no authentication on the endpoint (any local process can call tools)');
  s.exit = await sc.close();
  s.stderr = truncate(sc.stderr, 400);
  await sleep(500);
  s.serverAliveAfterNullBody = alive2;
}

// ---------- main ----------
const load = os.loadavg()[0];
try {
  await runGovernance();
  await runSwarm();
  await runProjectState();
  await runAxonBridge();
} catch (error) {
  limitations.push(`journey aborted by exception: ${error.stack}`);
}

// crash-probe findings
for (const s of servers) {
  const cp = s.crashProbe;
  if (cp) {
    const diedAll = cp.probes.filter((p) => p.serverAlive === false);
    const died = diedAll[0];
    if (died)
      findings.push({
        id: `F-${s.nome}-crash-on-non-object`,
        severity: 'medium',
        server: s.nome,
        summary: `a single stdio line containing valid JSON that is not an object (killed by: ${diedAll.map((p) => p.probe).join(', ')}; survived: ${
          cp.probes
            .filter((p) => p.serverAlive)
            .map((p) => p.probe)
            .join(', ') || 'none'
        }) kills the server process (unhandled rejection in the async readline handler)`,
        evidence: truncate(
          { probes: cp.probes.map((p) => `${p.probe}:alive=${p.serverAlive}`), stderrTail: cp.stderrTail, exit: diedAll[0].exit },
          400,
        ),
        where: 'tools/lib/mcp-transport.js:78 (destructure of null/non-object) invoked from :69 without try/catch',
      });
  }
}

// cleanup + orphan check
for (const p of cleanups) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
await sleep(800);
const orphans = spawned.filter(alive);
const axonOrphans = pgrep('axon mcp').filter((p) => !axonProcsBefore.includes(p));
const stray = pgrep(pkgRoot.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) + '/tools/mcp-');
for (const p of [...orphans, ...axonOrphans, ...stray]) {
  try {
    process.kill(p, 'SIGKILL');
  } catch {
    /* gone */
  }
}

const aggregate = (s) => {
  const all = [...s.chamadas, ...s.negacoes];
  const cnt = (x) => all.filter((e) => e.status === x).length;
  return { PASS: cnt('PASS'), FAIL: cnt('FAIL'), BLOCKED: cnt('BLOCKED') };
};
for (const s of servers) {
  s.resumo = aggregate(s);
  const { toolSchemas, ...rest } = s;
  Object.assign(s, rest);
  delete s.toolSchemas;
}

const result = {
  gerado_em: new Date().toISOString(),
  pacote: { arquivo: tgz, sha256 },
  node: process.version,
  consumidor: { prefix, ...projectSetup, hseosVersion: JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version },
  axon_no_path: axonOnPath,
  load1_inicio: load,
  servidores: servers,
  achados: findings,
  processos: { spawned, orfaos_apos_encerrar: orphans, axon_orfaos: axonOrphans, strays_mortos_na_limpeza: stray },
  limitacoes: [
    ...limitations,
    'governance/swarm/project-state were exercised only in the normal installed mode (NODE_ENV and HSEOS_GOVERNED_EXECUTION_FIXTURE unset) => legacy server path; the native governed path is fixture-gated and was not exercised here.',
    'axon-bridge exposes no stdio mode; exercised over HTTP on an ephemeral port (127.0.0.1).',
    'No MCP schema validation exists in the legacy transport, so "invalid argument" negatives depend on incidental handler exceptions.',
  ],
};
fs.writeFileSync(path.join(outDir, 'mcp-journey-result.json'), JSON.stringify(result, null, 2));
const line = (s) =>
  `${s.nome.padEnd(22)} ${s.caminho.padEnd(8)} tools=${String(s.tools.length).padEnd(3)} PASS=${s.resumo.PASS} FAIL=${s.resumo.FAIL} BLOCKED=${s.resumo.BLOCKED}`;
console.log(servers.map(line).join('\n'));
console.log(
  `findings: ${findings.length}; orphans: ${orphans.length + axonOrphans.length}; out: ${path.join(outDir, 'mcp-journey-result.json')}`,
);
const rank = { low: 1, medium: 2, high: 3 };
const failOn = opt('fail-on', 'none');
if (failOn !== 'none' && !rank[failOn]) {
  console.error('--fail-on must be none, low, medium or high');
  process.exit(2);
}
if (failOn !== 'none' && findings.some((f) => (rank[f.severity] ?? 3) >= rank[failOn])) process.exit(1);
