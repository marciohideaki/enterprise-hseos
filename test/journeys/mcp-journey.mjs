// A4 - installed-package MCP journey (4 HSEOS MCP servers).
// Usage: node test/journeys/mcp-journey.mjs --prefix <consumer project> --tgz <packed tarball> --out <dir> [--mode legacy|modern] [--fail-on none|low|medium|high] [--axon-real optional|required]
// --mode legacy (default): the installed servers on a v4 state database, legacy protocol (unchanged behaviour).
// --mode modern: the SAME steps on an ACTIVATED state database (activateExecutionLedger with a fixture ADR-0048 in a scratch dir), speaking
// the 2026-07-28 protocol (server/discover, per-request _meta, Mcp-* headers on HTTP, MRTR approvals), on stdio and HTTP for all four
// servers, plus a compat block that speaks legacy `initialize` to the modern server and repeats the scope negatives.
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
import net from 'node:net';
import os from 'node:os';
import { createRequire } from 'node:module';
import { ACCEPT, DECLINE, ELICITATION, LEGACY_COMPAT_VERSIONS, loadModernProtocol } from './mcp-modern-protocol.mjs';

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
const mode = opt('mode', 'legacy');
if (!['legacy', 'modern'].includes(mode)) {
  console.error('--mode must be legacy or modern');
  process.exit(2);
}
const MODERN = mode === 'modern';
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
// legacy mode must not see an operator-provided state db; modern mode points every server at the activated db (set below).
delete cleanEnv.HSEOS_STATE_DB;
delete cleanEnv.HSEOS_LEGACY_TELEMETRY_DB;
if (MODERN) delete cleanEnv.HSEOS_MCP_LEGACY_SUNSET;
const mp = MODERN ? loadModernProtocol(pkgRoot) : null;

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

// Modern mode: the consumer's state db is ACTIVATED (user_version 17 + execution tables) with a FIXTURE ADR-0048 `Accepted` in a scratch
// directory (internal.decisionsDirectory); the real ADR stays Proposed. Only the consumer's own db is touched, never a real project.db.
const stateDb = path.join(prefix, '.hseos', 'state', 'project.db');
if (MODERN) {
  const dbLib = createRequire(path.join(pkgRoot, 'package.json'))('./tools/mcp-project-state/lib/operational-state-db.js');
  const before = dbLib.resolveGovernedExecutionMode(stateDb);
  if (before.mode === 'modern') {
    projectSetup.activation = { reused: true, ...before };
  } else {
    const decisions = path.join(outDir, 'adr-fixture');
    fs.mkdirSync(decisions, { recursive: true });
    fs.writeFileSync(
      path.join(decisions, 'ADR-0048-governed-execution-activation-criterion.md'),
      '# ADR-0048 (journey FIXTURE, not the real ADR)\n\n## Status\n\nAccepted - 2026-10-22\n',
    );
    fs.mkdirSync(path.dirname(stateDb), { recursive: true });
    if (!fs.existsSync(stateDb)) dbLib.openOperationalStateDatabase(stateDb).close();
    const receipt = await dbLib.activateExecutionLedger(stateDb, {
      adr: 'ADR-0048',
      backupDir: path.join(outDir, 'activation-backups'),
      internal: { decisionsDirectory: decisions },
    });
    projectSetup.activation = {
      reused: false,
      ...dbLib.resolveGovernedExecutionMode(stateDb),
      user_version_after: receipt.receipt.user_version_after,
    };
  }
  if (projectSetup.activation.mode !== 'modern') {
    console.error(`activation failed: ${JSON.stringify(projectSetup.activation)}`);
    process.exit(2);
  }
  cleanEnv.HSEOS_STATE_DB = stateDb;
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
// Modern/compat exchange shared by the stdio and HTTP clients. proto: 'legacy' (untouched wire), 'modern' (2026-07-28: per-request _meta,
// MRTR approvals answered with ctx.decision) or 'compat' (legacy wire to a modern server; replies still come in the governed envelope).
// Replies of modern/compat are normalized (see mcp-modern-protocol.mjs) so the legacy judges compare the SAME semantics.
const RUN_TAG = Date.now();
let clientSeq = 0;
async function governedExchange(ctx, send, method, params, id) {
  const wire = ctx.proto === 'modern';
  const key = `jr-${RUN_TAG}-${ctx.tag}-${id}`;
  let resp = await send(method, wire ? mp.withMeta(params, { capabilities: ctx.caps, key }) : params, id);
  let prompted = false;
  if (wire && method === 'tools/call' && resp?.result?.resultType === 'input_required') {
    prompted = true;
    ctx.approvals.push({ tool: params?.name, decision: ctx.decision === DECLINE ? 'decline' : 'accept' });
    const answered = { ...params, requestState: resp.result.requestState, inputResponses: ctx.decision };
    resp = await send(method, mp.withMeta(answered, { capabilities: ctx.caps, key }), `${id}-mrtr`);
  }
  resp = mp.normalize(method, resp);
  if (resp && typeof resp === 'object') Object.defineProperty(resp, 'prompted', { value: prompted });
  return resp;
}
const newGovernedState = (proto, label) => ({
  proto,
  tag: `${label}-${clientSeq++}`,
  caps: ELICITATION,
  decision: ACCEPT,
  approvals: [],
});

class StdioClient {
  constructor(script, extraArgs = [], env = cleanEnv, cwd = prefix, proto = MODERN ? 'modern' : 'legacy') {
    Object.assign(this, newGovernedState(proto, path.basename(path.dirname(script))));
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
    if (this.proto === 'legacy') return this.rawRpc(method, params, id, timeout);
    return governedExchange(this, (m, p, i) => this.rawRpc(m, p, i, timeout), method, params, id);
  }
  async rawRpc(method, params, id, timeout = 8000) {
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

// Modern handshake: there is no session, so the first contact is server/discover; the tool list is then read per request.
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';
function recordToolCatalog(server, list) {
  server.tools = (list?.result?.tools || []).map((t) => t.name);
  push(server.chamadas, {
    tool: 'tools/list',
    status: server.tools.length > 0 ? 'PASS' : 'FAIL',
    evidence: `${server.tools.length} tools: ${server.tools.join(',')}`,
  });
  if (MODERN && server.expectTools !== undefined)
    push(server.chamadas, {
      tool: 'tools/list count',
      status: server.tools.length === server.expectTools ? 'PASS' : 'FAIL',
      evidence: `${server.tools.length} tools, expected ${server.expectTools}`,
    });
}
async function discoverHandshake(c, server) {
  const d = await c.rpc('server/discover', {}, 1);
  const ok = d?.result?.resultType === 'complete' && d.result.supportedVersions?.includes(mp.VERSION);
  server.initialize = d?.result
    ? { protocolVersion: mp.VERSION, supportedVersions: d.result.supportedVersions, serverInfo: d.result._meta?.[SERVER_INFO_KEY] }
    : truncate(d);
  push(server.chamadas, { tool: 'server/discover', status: ok ? 'PASS' : 'FAIL', evidence: truncate(server.initialize, 240) });
  recordToolCatalog(server, await c.rpc('tools/list', {}, 2));
  return d;
}

async function stdioHandshake(c, server, version = '2024-11-05') {
  if (c.proto === 'modern') return discoverHandshake(c, server);
  const init = await c.rpc(
    'initialize',
    { protocolVersion: version, capabilities: {}, clientInfo: { name: 'a4-journey', version: '0' } },
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
  recordToolCatalog(server, await c.rpc('tools/list', {}, 2));
  return init;
}

// Modern/compat only. The server must be on the modern path of an activated db (its banner says so), not the legacy fallback.
function recordModernPath(s, c) {
  push(s.chamadas, {
    tool: '(modern path on activated db)',
    status: s.caminho === 'native' && /mode=activated/.test(c.stderr) ? 'PASS' : 'FAIL',
    evidence: `caminho=${s.caminho}; stderr=${truncate(c.stderr.trim().split('\n')[0] ?? '', 120)}`,
    kind: 'protocol-era',
  });
}

// Modern only. Approval-required tool over MRTR: DECLINE must refuse and leave no effect (verifyNoEffect proves it); a client without the
// elicitation capability must be refused with -32021 and leave no effect. `call(tool,args,id)` is the connection's tools/call.
async function mrtrNegatives(c, s, call, { tool, args, id, verifyNoEffect }) {
  c.decision = DECLINE;
  const declined = await call(tool, args, id);
  c.decision = ACCEPT;
  const after = await verifyNoEffect();
  push(s.negacoes, {
    tool: `${tool} (MRTR decline)`,
    args: truncate(args, 160),
    kind: 'mrtr-decline',
    status: declined?.prompted && declined?.error && after[0] ? 'PASS' : 'FAIL',
    evidence: `prompted=${declined?.prompted}; after decline: ${declined?.error ? `refused ${declined.error.code} ${truncate(declined.error.message, 100)}` : `NOT refused ${truncate(declined, 160)}`}; ${after[1]}`,
  });
  c.caps = {};
  const noCap = await call(tool, args, id + 1);
  c.caps = ELICITATION;
  const afterNoCap = await verifyNoEffect();
  push(s.negacoes, {
    tool: `${tool} (no elicitation capability)`,
    args: truncate(args, 160),
    kind: 'mrtr-no-capability',
    status: noCap?.error?.code === -32_021 && afterNoCap[0] ? 'PASS' : 'FAIL',
    evidence: `${noCap?.error ? `error ${noCap.error.code} ${truncate(noCap.error.message, 100)}` : `NOT refused ${truncate(noCap, 160)}`}; ${afterNoCap[1]}`,
  });
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
const base = (nome, script, transporte, expectTools) => ({
  nome,
  script: path.relative(prefix, script),
  caminho: null,
  transporte,
  expectTools,
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

// Governance out-of-scope negatives over any connection (`call(tool,args,id)` speaks its protocol). Modern/compat add NUL and absolute-path probes.
async function governanceScopeNegatives(s, call) {
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
  if (!MODERN) return;
  for (const [tool, key, value, label] of [
    ['check_authority', 'agent_code', 'SWARM\u0000../../etc', 'nul-byte'],
    ['check_authority', 'agent_code', '/etc', 'absolute-path'],
    ['query_constitution', 'article', '/etc/passwd', 'absolute-path'],
    ['query_constitution', 'article', 'a\u0000/etc/passwd', 'nul-byte'],
  ]) {
    const resp = await call(tool, { [key]: value }, 23);
    const payload = toolPayload(resp);
    push(s.negacoes, {
      tool,
      args: truncate({ [key]: value }, 100),
      kind: `out-of-scope-path:${label}`,
      status: resp?.error || (payload && !payload.authority && !payload.text && !has(payload, 'root:')) ? 'PASS' : 'FAIL',
      evidence: `no file content returned: ${truncate(resp?.error ?? payload, 160)}`,
    });
  }
}

// ============ 1. governance ============
async function runGovernance() {
  const s = base('hseos-governance', SERVER('mcp-hseos-governance'), 'stdio', 15);
  servers.push(s);
  const c = new StdioClient(SERVER('mcp-hseos-governance'));
  await sleep(1200);
  s.caminho = detectPath(c);
  await stdioHandshake(c, s);
  if (MODERN) recordModernPath(s, c);
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
  await governanceScopeNegatives(s, call);
  s.notas.push(`spec root is the installed package (${pkgRoot}); specs are bundled, so this is intended`);
  const tele = path.join(prefix, '.hseos', 'state', 'mcp-legacy-usage.db');
  s.notas.push(`legacy telemetry db written in consumer project: ${fs.existsSync(tele)} (${path.relative(prefix, tele)})`);
  await finishStdio(s, c);
}

// Out-of-scope negatives of swarm, over any connection: `call(tool, args, id)` speaks the connection's protocol. proto: 'legacy' (v4 db),
// 'modern' (2026-07-28, activated db) or 'compat' (legacy initialize to the modern server). The PASS criterion is the same everywhere:
// an explicit refusal, nothing outside the runs dir read, nothing outside it written. Modern/compat add the domain code to the criterion.
// Reads must be denied with MCP_SCOPE_DENIED. A write is refused by the scope check only AFTER the approval step in modern (the code
// then is EXECUTION_OUTCOME_IN_DOUBT with the scope reason, see the findings) and by MCP_LEGACY_APPROVAL_UNSUPPORTED in compat.
async function swarmScopeNegatives(s, call, { runsRoot, runId, proto }) {
  const READ_CODES = new Set(['MCP_SCOPE_DENIED']);
  // consolidate_handoff writes a handoff file, so it is approval-gated and follows the write rules even though the journey probes it as a read
  const APPROVAL_GATED = new Set(['consolidate_handoff']);
  const domainOk = (resp, kind, tool) => {
    if (proto === 'legacy') return [true, ''];
    const code = resp?.error?.code;
    if (code === -32_602 && !resp.error.domain) return [true, ' (schema rejection -32602)'];
    if (kind === 'read' && !APPROVAL_GATED.has(tool))
      return [READ_CODES.has(code), READ_CODES.has(code) ? '' : ` (domain code ${code}, expected MCP_SCOPE_DENIED)`];
    if (proto === 'compat') return [code === 'MCP_LEGACY_APPROVAL_UNSUPPORTED', ` (domain code ${code})`];
    // modern writes: exactly MCP_SCOPE_DENIED and before any approval prompt (K11 moved the scope check ahead of the approval)
    const ok = code === 'MCP_SCOPE_DENIED' && !resp.prompted;
    return [ok, ` (domain code ${code}${resp.prompted ? ', refused AFTER the approval prompt' : ', refused before any prompt'})`];
  };
  // ---- out-of-scope: every escape must be an explicit error AND leak/write nothing
  const tag = `${process.pid}-${Date.now()}`;
  const sfx = ++scopeInvocations === 1 ? '' : `-${scopeInvocations}`; // the first invocation keeps the historical fixture names
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
      status: resp?.error && !leaked && domainOk(resp, 'read', tool)[0] ? 'PASS' : 'FAIL',
      evidence: leaked
        ? `LEAK: outside canary returned (${truncate(resp, 160)})`
        : resp?.error
          ? `denied code=${resp.error.code} ${truncate(resp.error.message, 160)}${domainOk(resp, 'read', tool)[1]}`
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
      status: resp?.error && !wrote && domainOk(resp, 'write')[0] ? 'PASS' : 'FAIL',
      evidence: wrote
        ? `WROTE ${probeFile}`
        : resp?.error
          ? `denied code=${resp.error.code} ${truncate(resp.error.message, 160)}${domainOk(resp, 'write')[1]}`
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
  const linkDir = path.join(runsRoot, `a4-link-dir${sfx}`);
  fs.symlinkSync(readCanary, linkDir);
  cleanups.push(linkDir);
  await escapeRead('symlinked-run-dir', 'get_run_state', { run_id: `a4-link-dir${sfx}` });
  const linkFileRun = path.join(runsRoot, `a4-linkfile-run${sfx}`);
  fs.mkdirSync(linkFileRun, { recursive: true });
  fs.symlinkSync(path.join(readCanary, 'STATUS.md'), path.join(linkFileRun, 'STATUS.md'));
  fs.symlinkSync(path.join(readCanary, 'WAVE-1.md'), path.join(linkFileRun, 'WAVE-1.md'));
  cleanups.push(linkFileRun);
  await escapeRead('symlinked-file', 'get_run_state', { run_id: `a4-linkfile-run${sfx}` });
  const danglingLink = path.join(runsRoot, `a4-dangling${sfx}`);
  fs.symlinkSync(path.join(os.tmpdir(), `a4-does-not-exist-${tag}`), danglingLink);
  cleanups.push(danglingLink);
  await escapeRead('dangling-symlink', 'get_run_state', { run_id: `a4-dangling${sfx}` });
  // writes
  await escapeWrite(
    'relative-traversal',
    'plan_squad',
    { batch_description: 'x', run_id: rel(writeTarget) },
    path.join(writeTarget, 'PLAN.md'),
  );
  await escapeWrite('absolute-path', 'plan_squad', { batch_description: 'x', run_id: writeTarget }, path.join(writeTarget, 'PLAN.md'));
  const linkW = path.join(runsRoot, `a4-link-w${sfx}`);
  fs.symlinkSync(writeTarget, linkW);
  cleanups.push(linkW);
  await escapeWrite(
    'symlinked-run-dir',
    'plan_squad',
    { batch_description: 'x', run_id: `a4-link-w${sfx}` },
    path.join(writeTarget, 'PLAN.md'),
  );
  if (proto === 'compat') {
    // compat writes stop at MCP_LEGACY_APPROVAL_UNSUPPORTED before reaching the scope check, so the scope is also proven by READS of the
    // same hostile run ids (reads are not approval-gated)
    await escapeRead('write-id:relative-traversal', 'get_run_state', { run_id: rel(writeTarget) });
    await escapeRead('write-id:absolute-path', 'get_run_state', { run_id: writeTarget });
    await escapeRead('write-id:symlinked-run-dir', 'get_run_state', { run_id: `a4-link-w${sfx}` });
    await escapeRead('write-id:nul-byte', 'get_run_state', { run_id: `a4-nul\u0000${rel(writeTarget)}` });
  }
  if (proto !== 'legacy') {
    // modern/compat extras: NUL byte and percent-encoded traversal in the run id (read and write)
    await escapeRead('nul-byte', 'get_run_state', { run_id: `${runId}\u0000/../../..` });
    await escapeRead('percent-encoded-traversal', 'get_run_state', { run_id: '..%2f..%2f..%2fetc' });
    await escapeWrite(
      'nul-byte',
      'plan_squad',
      { batch_description: 'x', run_id: `a4-nul\u0000${rel(writeTarget)}` },
      path.join(writeTarget, 'PLAN.md'),
    );
  }
}

let scopeInvocations = 0;
let swarmRunId = null; // a run created by the swarm stage, reused by the compat/HTTP stages (compat cannot create runs: approvals are unsupported)

// ============ 2. swarm ============
async function runSwarm() {
  const s = base('hseos-swarm', SERVER('mcp-hseos-swarm'), 'stdio', 5);
  servers.push(s);
  const c = new StdioClient(SERVER('mcp-hseos-swarm'));
  await sleep(1200);
  s.caminho = detectPath(c);
  await stdioHandshake(c, s);
  if (MODERN) recordModernPath(s, c);
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
  swarmRunId = runId;
  const pl = await call('plan_squad', { batch_description: 'a4 journey probe', run_id: runId }, 11);
  const plp = toolPayload(pl);
  cleanups.push(path.join(runsRoot, runId));
  if (MODERN)
    push(s.chamadas, {
      tool: 'plan_squad (MRTR accept)',
      status: pl?.prompted ? 'PASS' : 'NOT_EXERCISED',
      evidence: pl?.prompted
        ? `input_required answered with accept; approvals=${JSON.stringify(c.approvals)}`
        : 'the server did not ask for approval on plan_squad, so the MRTR accept path was not exercised',
      kind: 'mrtr-accept',
    });
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

  await swarmScopeNegatives(s, call, { runsRoot, runId, proto: c.proto });
  if (MODERN) {
    const declinedId = `a4-declined-${Date.now()}`;
    cleanups.push(path.join(runsRoot, declinedId));
    await mrtrNegatives(c, s, call, {
      tool: 'plan_squad',
      args: { batch_description: 'declined', run_id: declinedId },
      id: 400,
      verifyNoEffect: async () => {
        const created = fs.existsSync(path.join(runsRoot, declinedId));
        return [!created, created ? `CREATED ${declinedId}` : 'nothing created on disk'];
      },
    });
  }
  await finishStdio(s, c);
}

// Modern only. project-state approval-required tools (state_write, tasks_update) over MRTR: the accept path was already taken by the main
// steps (c.approvals records it); here DECLINE and a client without elicitation must refuse and leave no effect.
let verifySeq = 5000;
async function projectStateMrtr(c, s, call, mark, tid) {
  for (const tool of ['state_write', 'tasks_update']) {
    const hit = c.approvals.find((a) => a.tool === tool && a.decision === 'accept');
    push(s.chamadas, {
      tool: `${tool} (MRTR accept)`,
      status: hit ? 'PASS' : 'NOT_EXERCISED',
      evidence: hit
        ? 'input_required answered with accept and the step succeeded'
        : `the server did not ask for approval on ${tool}: accept path not exercised`,
      kind: 'mrtr-accept',
    });
  }
  const declinedValue = `a4-declined-${Date.now()}`;
  await mrtrNegatives(c, s, call, {
    tool: 'state_write',
    args: { fields: { a4_declined: declinedValue }, agent: 'a4' },
    id: 410,
    verifyNoEffect: async () => {
      const state = toolPayload(await call('state_read', {}, verifySeq++));
      const written = state?.state?.a4_declined === declinedValue;
      return [!written, written ? 'DECLINED VALUE WAS WRITTEN' : 'state unchanged'];
    },
  });
  const tid2 = `${tid}-declined`;
  record(
    s.chamadas,
    'tasks_add (for decline)',
    { id: tid2 },
    await call('tasks_add', { id: tid2, owner: 'a4', description: 'decline probe' }, 415),
    'ok',
    (r, p) => [p?.added === tid2, ''],
  );
  await mrtrNegatives(c, s, call, {
    tool: 'tasks_update',
    args: { id: tid2, status: 'done' },
    id: 420,
    verifyNoEffect: async () => {
      const pending = toolPayload(await call('tasks_list', { status: 'pending' }, verifySeq++));
      const still = (pending?.tasks || []).some((t) => t.id === tid2);
      return [still, still ? 'task still pending' : 'TASK CHANGED WITHOUT APPROVAL'];
    },
  });
}

// project-state has no client-reachable filesystem path; the closest scope surface is the run id looked up in the db. Modern/compat probe it.
async function projectStateScopeNegatives(s, call) {
  for (const [label, runId] of [
    ['traversal', '../../../../etc/passwd'],
    ['absolute-path', '/etc/passwd'],
    ['nul-byte', 'a\u0000/etc/passwd'],
  ]) {
    const resp = await call('run_describe', { run_id: runId }, 30);
    push(s.negacoes, {
      tool: 'run_describe',
      args: truncate({ run_id: runId }, 100),
      kind: `out-of-scope-path:${label}`,
      status: (resp?.error || toolPayload(resp)?.error) && !has(resp, 'root:') ? 'PASS' : 'FAIL',
      evidence: `refused, no file content: ${truncate(resp?.error ?? toolPayload(resp), 160)}`,
    });
  }
}

// ============ 3. project-state ============
async function runProjectState() {
  const s = base('hseos-project-state', SERVER('mcp-project-state'), 'stdio', 15);
  servers.push(s);
  const c = new StdioClient(SERVER('mcp-project-state'));
  await sleep(2000);
  s.caminho = detectPath(c);
  await stdioHandshake(c, s);
  if (MODERN) recordModernPath(s, c);
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
  if (MODERN) await projectStateMrtr(c, s, call, mark, tid);
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
  if (MODERN) await projectStateScopeNegatives(s, call);
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
  const s = base('axon-bridge[stdio]', SERVER('mcp-axon-bridge'), 'stdio (default, no flags)', 6);
  servers.push(s);
  axonFixtureState = prepareAxonFixture();
  const c = new StdioClient(SERVER('mcp-axon-bridge'), [], cleanEnv, axonFixture);
  await sleep(1500);
  s.caminho = detectPath(c);
  s.notas.push(`axon on PATH: ${axonOnPath}; fixture project ${axonFixture}: ${axonFixtureState.reason}`);
  await stdioHandshake(c, s);
  if (MODERN) recordModernPath(s, c);
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
  const s = base('axon-bridge[axon-absent]', SERVER('mcp-axon-bridge'), 'stdio, axon removed from PATH', 6);
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
  if (MODERN) recordModernPath(s, c);
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
  const s = base('axon-bridge[http]', SERVER('mcp-axon-bridge'), 'http (--port=0) + bearer credential', 6);
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
  // legacy posts to `/`; modern posts to `/mcp` with the MCP-Protocol-Version / Mcp-Method / Mcp-Name headers and per-request _meta.
  const RPC_PATH = MODERN ? '/mcp' : '/';
  const httpCtx = newGovernedState(MODERN ? 'modern' : 'legacy', 'axon-http');
  const authRaw = MODERN ? { ...auth, 'mcp-protocol-version': mp.VERSION } : auth;
  let rid = 1;
  const sendH = async (method, params, id) =>
    (
      await httpRaw(port, {
        method: 'POST',
        pth: RPC_PATH,
        headers: MODERN ? { ...mp.httpHeaders(method, params?.name), authorization: auth.authorization } : auth,
        body: { jsonrpc: '2.0', id, method, params },
      })
    ).json;
  const rpcH = (method, params) => (MODERN ? governedExchange(httpCtx, sendH, method, params, rid++) : sendH(method, params, rid++));
  // unauthenticated / wrongly authenticated / browser-origin / foreign host must all be refused
  const rejects = [
    ['no Authorization header', { headers: { 'content-type': 'application/json' } }, 401],
    ['wrong bearer', { headers: { authorization: `Bearer ${'0'.repeat(48)}`, 'content-type': 'application/json' } }, 401],
    ['Basic scheme', { headers: { authorization: `Basic ${credential}` } }, 401],
    ['Origin header present', { headers: { ...auth, origin: 'http://evil.example' } }, 403],
    ['foreign Host header', { headers: { ...auth, host: 'evil.example:80' } }, 403],
  ];
  for (const [label, extra, expected] of rejects) {
    const r = await httpRaw(port, {
      method: 'POST',
      pth: RPC_PATH,
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: MODERN ? mp.withMeta({}) : undefined },
      ...extra,
      headers: { ...(MODERN ? mp.httpHeaders('tools/list') : {}), ...extra.headers },
    });
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
  if (MODERN) {
    const d = await rpcH('server/discover', {});
    const ok = d?.result?.resultType === 'complete' && d.result.supportedVersions?.includes(mp.VERSION);
    s.initialize = d?.result
      ? { protocolVersion: mp.VERSION, supportedVersions: d.result.supportedVersions, serverInfo: d.result._meta?.[SERVER_INFO_KEY] }
      : d;
    push(s.chamadas, { tool: 'server/discover', status: ok ? 'PASS' : 'FAIL', evidence: truncate(s.initialize, 240) });
  } else {
    const init = await rpcH('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a4' } });
    s.initialize = init?.result ? { protocolVersion: init.result.protocolVersion, serverInfo: init.result.serverInfo } : init;
    push(s.chamadas, {
      tool: 'initialize',
      status: init?.result?.protocolVersion ? 'PASS' : 'FAIL',
      evidence: truncate(s.initialize, 200),
    });
  }
  recordToolCatalog(s, await rpcH('tools/list', {}));
  for (const [name, args] of AXON_TOOL_CALLS) {
    const resp = await rpcH('tools/call', { name, arguments: args });
    if (!axonOnPath || !axonFixtureState?.ok) push(s.chamadas, axonRealUnavailable(s.nome, name, args, axonFixtureState?.reason));
    else record(s.chamadas, name, args, resp, 'ok', () => [realAxonAnswer(resp), 'real axon answer (no fallback marker)']);
  }
  // a JSON-RPC notification has no modern form (the modern endpoint demands per-request metadata): it is sent on the plain request path
  const notif = await httpRaw(port, {
    method: 'POST',
    pth: RPC_PATH,
    headers: auth,
    body: { jsonrpc: '2.0', method: 'notifications/initialized' },
  });
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
  const bad = await httpRaw(port, { method: 'POST', pth: RPC_PATH, headers: authRaw, body: '{not json' });
  push(s.negacoes, {
    tool: 'HTTP malformed body',
    kind: 'malformed-input',
    status: bad.status === 400 && bad.json?.error?.code === -32_700 ? 'PASS' : 'FAIL',
    evidence: `http ${bad.status} ${truncate(bad.text, 120)}`,
  });
  const meth = await httpRaw(port, { pth: MODERN ? '/mcp' : '/tools', headers: { authorization: `Bearer ${credential}` } });
  push(s.negacoes, {
    tool: MODERN ? 'HTTP GET /mcp' : 'HTTP GET /tools',
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
    const r = await httpRaw(port, { method: 'POST', pth: RPC_PATH, headers: authRaw, body });
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

// ============ modern-only stages: HTTP for governance/swarm/project-state, and the legacy-inside-modern (compat) block ============
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// HTTP client of the modern journey: modern (2026-07-28 headers + _meta + MRTR) or compat (plain legacy requests to the modern server).
class HttpClient {
  constructor(port, proto, label, bearer) {
    Object.assign(this, newGovernedState(proto, label));
    this.port = port;
    this.bearer = bearer;
  }
  async sendRaw(method, params, id) {
    const headers = this.proto === 'modern' ? mp.httpHeaders(method, params?.name) : { 'content-type': 'application/json' };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    const r = await httpRaw(this.port, { method: 'POST', pth: '/mcp', headers, body: { jsonrpc: '2.0', id, method, params } });
    return r.json ?? { http_status: r.status, body: r.text.slice(0, 300) };
  }
  rpc(method, params, id) {
    return governedExchange(this, (m, p, i) => this.sendRaw(m, p, i), method, params, id);
  }
}

const HTTP_SERVERS = {
  governance: { dir: 'mcp-hseos-governance', tools: 15 },
  swarm: { dir: 'mcp-hseos-swarm', tools: 5 },
  'project-state': { dir: 'mcp-project-state', tools: 15, health: 16 }, // /health also counts the unlisted scheduler_sweep_orphans (K7)
};

// Scope negatives of one server through ONE connection (modern or compat; stdio or HTTP). `ctx` carries what the stage created.
async function scopeNegativesFor(key, s, conn, ctx) {
  const call = (name, args, id) => conn.rpc('tools/call', { name, arguments: args }, id);
  switch (key) {
    case 'governance': {
      await governanceScopeNegatives(s, call);
      break;
    }
    case 'project-state': {
      await projectStateScopeNegatives(s, call);
      break;
    }
    case 'swarm': {
      const runsRoot = path.join(prefix, '.hseos', 'runs', 'dev-squad');
      fs.mkdirSync(runsRoot, { recursive: true });
      await swarmScopeNegatives(s, call, { runsRoot, runId: ctx.runId ?? swarmRunId ?? 'a4-no-run', proto: conn.proto });

      break;
    }
    case 'axon-bridge': {
      const sk = await call('get_skeleton', { files: ['/etc/passwd', '../../../../etc/shadow'] }, 31);
      push(s.negacoes, {
        tool: 'get_skeleton',
        args: '{"files":["/etc/passwd","../../../../etc/shadow"]}',
        kind: 'out-of-scope-path',
        status: has(sk, 'root:') ? 'FAIL' : 'PASS',
        evidence: has(sk, 'root:')
          ? `LEAK ${truncate(sk, 200)}`
          : `no /etc/passwd content returned: ${truncate(sk?.error ?? toolPayload(sk), 160)}`,
      });

      break;
    }
    // No default
  }
}

const rawStatus = (port, label, expected, spec, judge) =>
  httpRaw(port, spec).then((r) => ({
    label,
    status: r.status === expected && (judge ? judge(r) : true) ? 'PASS' : 'FAIL',
    evidence: `http ${r.status} (expected ${expected}) ${truncate(r.text, 140)}`,
  }));

async function runModernHttp(key) {
  const def = HTTP_SERVERS[key];
  const s = base(
    `${key === 'project-state' ? 'hseos-project-state' : `hseos-${key}`}[http]`,
    SERVER(def.dir),
    'http (modern, 127.0.0.1)',
    def.tools,
  );
  servers.push(s);
  const port = await freePort();
  const c = new StdioClient(SERVER(def.dir), [`--port=${port}`]);
  try {
    await modernHttpBody(key, def, s, c, port);
  } finally {
    s.exit = await c.close();
    s.stderr = truncate(c.stderr, 400);
  }
}

async function modernHttpBody(key, def, s, c, port) {
  await sleep(key === 'project-state' ? 2200 : 1500);
  s.caminho = detectPath(c);
  recordModernPath(s, c);
  const health = await httpRaw(port, { pth: '/health' });
  push(s.chamadas, {
    tool: 'GET /health',
    status: health.json?.status === 'ok' && health.json?.tools === (def.health ?? def.tools) ? 'PASS' : 'FAIL',
    evidence: truncate(health.json ?? health.text, 200),
  });
  push(s.negacoes, {
    tool: '(stdout framing)',
    status: c.badLines.length === 0 && c.lines.length === 0 ? 'PASS' : 'FAIL',
    evidence: 'HTTP mode must not write protocol lines to stdout',
  });
  const h = new HttpClient(port, 'modern', key);
  await discoverHandshake(h, s);
  const call = (name, args, id) => h.rpc('tools/call', { name, arguments: args }, id);
  const ctx = {};
  if (key === 'governance') {
    record(
      s.chamadas,
      'check_authority',
      { agent_code: 'SWARM' },
      await call('check_authority', { agent_code: 'SWARM' }, 10),
      'ok',
      (r, p) => [!!p && !p.error && !!p.authority, `authority_len=${(p?.authority || '').length}`],
    );
  } else if (key === 'swarm') {
    const runsRoot = path.join(prefix, '.hseos', 'runs', 'dev-squad');
    fs.mkdirSync(runsRoot, { recursive: true });
    const runId = `a4-http-${Date.now()}`;
    cleanups.push(path.join(runsRoot, runId));
    ctx.runId = runId;
    const pl = await call('plan_squad', { batch_description: 'a4 http probe', run_id: runId }, 10);
    record(s.chamadas, 'plan_squad', { run_id: runId }, pl, 'ok', (r, p) => [
      !!p?.run_dir && fs.existsSync(path.join(runsRoot, runId, 'PLAN.md')),
      `prompted=${pl?.prompted} run_dir=${p?.run_dir}`,
    ]);
    record(s.chamadas, 'get_run_state', { run_id: runId }, await call('get_run_state', { run_id: runId }, 11), 'ok', (r, p) => [
      !!p?.status,
      '',
    ]);
  } else {
    const mark = `a4-http-${Date.now()}`;
    record(
      s.chamadas,
      'state_write',
      { fields: { a4_marker: mark } },
      await call('state_write', { fields: { a4_marker: mark }, agent: 'a4' }, 10),
      'ok',
      (r, p) => [p?.written === 1, `written=${p?.written}`],
    );
    record(s.chamadas, 'state_read', {}, await call('state_read', {}, 11), 'ok', (r, p) => [p?.state?.a4_marker === mark, '']);
    const tid = `a4-http-task-${Date.now()}`;
    record(
      s.chamadas,
      'tasks_add',
      { id: tid },
      await call('tasks_add', { id: tid, owner: 'a4', description: 'http probe' }, 12),
      'ok',
      (r, p) => [p?.added === tid, ''],
    );
    record(
      s.chamadas,
      'tasks_update',
      { id: tid, status: 'done' },
      await call('tasks_update', { id: tid, status: 'done' }, 13),
      'ok',
      (r, p) => [p?.updated === tid, ''],
    );
    ctx.mark = mark;
    ctx.tid = tid;
  }
  // protocol negatives of the modern HTTP transport
  const body = (method, extra = {}) => ({ jsonrpc: '2.0', id: 1, method, params: mp.withMeta({ ...extra }) });
  for (const [label, expected, spec, judge] of [
    [
      'missing MCP-Protocol-Version header',
      400,
      {
        method: 'POST',
        pth: '/mcp',
        headers: { 'content-type': 'application/json', 'mcp-method': 'tools/list' },
        body: body('tools/list'),
      },
      (r) => r.json?.error?.code === -32_020,
    ],
    [
      'MCP-Protocol-Version header of another revision',
      400,
      {
        method: 'POST',
        pth: '/mcp',
        headers: { ...mp.httpHeaders('tools/list'), 'mcp-protocol-version': '2025-06-18' },
        body: body('tools/list'),
      },
      (r) => r.json?.error?.code === -32_020,
    ],
    [
      'Mcp-Method header differs from the body method',
      400,
      { method: 'POST', pth: '/mcp', headers: mp.httpHeaders('tools/call'), body: body('tools/list') },
      (r) => r.json?.error?.code === -32_020,
    ],
    [
      'malformed JSON body',
      400,
      { method: 'POST', pth: '/mcp', headers: mp.httpHeaders('tools/list'), body: '{not json' },
      (r) => r.json?.error?.code === -32_700,
    ],
    [
      'legacy path / (not the modern endpoint)',
      404,
      { method: 'POST', pth: '/', headers: mp.httpHeaders('tools/list'), body: body('tools/list') },
      undefined,
    ],
  ]) {
    const entry = await rawStatus(port, label, expected, spec, judge);
    push(s.negacoes, { tool: `HTTP ${entry.label}`, kind: 'http-transport', status: entry.status, evidence: entry.evidence });
  }
  for (const [label, raw] of [
    ['null', 'null'],
    ['number', '42'],
    ['array', '[]'],
    ['string', '"x"'],
  ]) {
    const r = await httpRaw(port, { method: 'POST', pth: '/mcp', headers: mp.httpHeaders('tools/list'), body: raw });
    push(s.negacoes, {
      tool: `HTTP body ${label}`,
      kind: 'non-object',
      status: r.json?.error?.code === -32_600 ? 'PASS' : 'FAIL',
      evidence: `http ${r.status} ${truncate(r.text, 140)}`,
    });
  }
  record(s.negacoes, 'unknown_tool_xyz', {}, await call('unknown_tool_xyz', {}, 20), 'denied', null, 'unknown-tool');
  record(s.negacoes, 'tools/call(no name)', {}, await h.rpc('tools/call', { arguments: {} }, 21), 'denied', null, 'missing-name', -32_602);
  record(s.negacoes, 'method unknown', {}, await h.rpc('nope/method', {}, 22), 'denied', null, 'unknown-method', -32_601);
  await scopeNegativesFor(key, s, h, ctx);
  if (key === 'swarm') {
    const declinedId = `a4-http-declined-${Date.now()}`;
    const runsRoot = path.join(prefix, '.hseos', 'runs', 'dev-squad');
    cleanups.push(path.join(runsRoot, declinedId));
    await mrtrNegatives(h, s, call, {
      tool: 'plan_squad',
      args: { batch_description: 'declined', run_id: declinedId },
      id: 400,
      verifyNoEffect: async () => {
        const created = fs.existsSync(path.join(runsRoot, declinedId));
        return [!created, created ? `CREATED ${declinedId}` : 'nothing created on disk'];
      },
    });
  } else if (key === 'project-state') {
    await projectStateMrtr(h, s, call, ctx.mark, ctx.tid);
  }
  const after = await httpRaw(port, { pth: '/health' });
  push(s.negacoes, {
    tool: '(still serving after the negatives)',
    kind: 'non-object',
    status: after.status === 200 ? 'PASS' : 'FAIL',
    evidence: `http ${after.status}`,
  });
  // compat on the same HTTP server: legacy requests (no Mcp-* headers) must get the same scope outcome
  for (const version of LEGACY_COMPAT_VERSIONS)
    await compatProbe(s, new HttpClient(port, 'compat', `${key}-${version}`), { key, version, expectTools: def.tools, ctx });
}

// One legacy `initialize` revision against the MODERN server: negotiation, tool catalog and the same scope negatives as the modern path.
async function compatProbe(s, conn, { key, version, expectTools, ctx = {} }) {
  const init = await conn.rpc(
    'initialize',
    { protocolVersion: version, capabilities: {}, clientInfo: { name: 'a4-compat', version: '0' } },
    1,
  );
  const negotiated = init?.result?.protocolVersion;
  push(s.chamadas, {
    tool: `initialize@${version}`,
    status: typeof negotiated === 'string' && LEGACY_COMPAT_VERSIONS.includes(negotiated) ? 'PASS' : 'FAIL',
    evidence: `negotiated=${negotiated} deprecation=${truncate(init?.result?._meta?.deprecation ?? null, 160)}`,
    kind: 'compat',
  });
  const list = await conn.rpc('tools/list', {}, 2);
  const names = (list?.result?.tools || []).map((t) => t.name);
  s.tools = names;
  push(s.chamadas, {
    tool: `tools/list@${version}`,
    status: names.length === expectTools ? 'PASS' : 'FAIL',
    evidence: `${names.length} tools, expected ${expectTools}`,
    kind: 'compat',
  });
  const before = s.negacoes.length;
  await scopeNegativesFor(key, s, conn, ctx);
  for (const entry of s.negacoes.slice(before)) {
    entry.tool = `${entry.tool} [compat ${version}]`;
    entry.kind = `compat:${entry.kind}`;
  }
}

async function runCompatStdio(key) {
  const defs = {
    governance: ['hseos-governance[compat]', 'mcp-hseos-governance', 15],
    swarm: ['hseos-swarm[compat]', 'mcp-hseos-swarm', 5],
    'project-state': ['hseos-project-state[compat]', 'mcp-project-state', 15],
    'axon-bridge': ['axon-bridge[compat]', 'mcp-axon-bridge', 6],
  };
  const [nome, dir, tools] = defs[key];
  const s = base(
    nome,
    SERVER(dir),
    'stdio, legacy initialize to the modern server (one connection per revision: the era is pinned)',
    tools,
  );
  servers.push(s);
  const env = key === 'axon-bridge' ? { ...cleanEnv, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` } : cleanEnv;
  for (const version of LEGACY_COMPAT_VERSIONS) {
    const c = new StdioClient(SERVER(dir), [], env, key === 'axon-bridge' ? axonFixture : prefix, 'compat');
    try {
      await sleep(key === 'project-state' ? 2000 : 1500);
      s.caminho = detectPath(c);
      if (version === LEGACY_COMPAT_VERSIONS[0]) recordModernPath(s, c);
      await compatProbe(s, c, { key, version, expectTools: tools });
    } finally {
      await finishStdio(s, c);
    }
  }
}

async function runAxonCompatHttp() {
  const s = base(
    'axon-bridge[compat-http]',
    SERVER('mcp-axon-bridge'),
    'http (--port=0) + bearer, legacy initialize to the modern server',
    6,
  );
  servers.push(s);
  const credential = crypto.randomBytes(24).toString('hex');
  secrets.push(credential);
  const env = { ...cleanEnv, HSEOS_AXON_BRIDGE_CREDENTIAL: credential, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
  const c = new StdioClient(SERVER('mcp-axon-bridge'), ['--port=0'], env, axonFixture, 'compat');
  await sleep(1800);
  s.caminho = detectPath(c);
  recordModernPath(s, c);
  const port = c.stderr.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
  if (!port) {
    push(s.chamadas, { tool: '(startup)', status: 'FAIL', evidence: `no listening port in stderr: ${truncate(c.stderr, 200)}` });
    await c.close();
    return;
  }
  try {
    for (const version of LEGACY_COMPAT_VERSIONS)
      await compatProbe(s, new HttpClient(Number(port), 'compat', `axon-${version}`, credential), {
        key: 'axon-bridge',
        version,
        expectTools: 6,
      });
  } finally {
    s.exit = await c.close();
    s.stderr = truncate(c.stderr, 400);
  }
}

// ---------- main ----------
const load = os.loadavg()[0];
const STAGES = [
  ['governance', runGovernance],
  ['swarm', runSwarm],
  ['project-state', runProjectState],
  ['axon-bridge[stdio]', runAxonStdio],
  ['axon-bridge[axon-absent]', runAxonAbsent],
  ['axon-bridge[http]', runAxonHttp],
];
if (MODERN) {
  for (const key of Object.keys(HTTP_SERVERS)) STAGES.push([`${key}[http]`, () => runModernHttp(key)]);
  for (const key of ['governance', 'swarm', 'project-state', 'axon-bridge']) STAGES.push([`${key}[compat]`, () => runCompatStdio(key)]);
  STAGES.push(['axon-bridge[compat-http]', runAxonCompatHttp]);
}
for (const [name, fn] of STAGES) {
  try {
    await fn();
  } catch (error) {
    aborts.push({ stage: name, error: String(error.stack || error) });
    limitations.push(`journey stage "${name}" aborted by exception: ${error.stack}`);
  }
}
const EXPECTED_STAGES = STAGES.length;

// Modern: ledger evidence (refused out-of-scope writes must leave no uncertain outcome).
let ledgerEvents = null;
if (MODERN) {
  const Database = createRequire(path.join(pkgRoot, 'package.json'))('better-sqlite3');
  const db = new Database(stateDb, { readonly: true });
  try {
    ledgerEvents = Object.fromEntries(
      db
        .prepare("SELECT aggregate_type || ':' || event_type AS k, COUNT(*) AS n FROM execution_events GROUP BY 1 ORDER BY 1")
        .all()
        .map((row) => [row.k, row.n]),
    );
  } finally {
    db.close();
  }
  const uncertain = ledgerEvents['execution:ExecutionOutcomeUncertain'] ?? 0;
  push(servers.find((x) => x.nome === 'hseos-swarm').chamadas, {
    tool: '(ledger: no ExecutionOutcomeUncertain event)',
    status: uncertain === 0 ? 'PASS' : 'FAIL',
    evidence: `ExecutionOutcomeUncertain events in the activated db: ${uncertain} (out-of-scope writes are refused before the approval, so none is expected)`,
    kind: 'ledger',
  });
}

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
  modo: mode,
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
  ...(MODERN ? { ativacao: projectSetup.activation, protocolo: mp.VERSION, ledger_eventos: ledgerEvents } : {}),
  contagens_de_ferramentas: Object.fromEntries(servers.map((x) => [x.nome, x.tools.length])),
  limitacoes: [
    ...limitations,
    ...(MODERN
      ? [
          'Modern mode: the state db is activated in a scratch consumer with a FIXTURE ADR-0048 (Accepted) via the internal decisionsDirectory option; the real ADR-0048 stays Proposed and no real project.db is touched.',
          'Modern replies come in the governed envelope {schema_version, ok, data|error}; the journey unwraps data.result and maps ok:false to a domain error before judging, so the assertions compare the same data and the same errors as the legacy journey (no assertion was loosened). Only legacy-protocol-specific steps (the notifications/initialized silence, the initialize handshake) are replaced by their modern equivalents (server/discover).',
          'In the compat block the swarm WRITE probes only prove MCP_LEGACY_APPROVAL_UNSUPPORTED (the legacy client cannot approve, so the request never reaches the scope check); the scope is proven there by READ probes of the same hostile run ids (write-id:* kinds). Mutation controls: loosening the run-id pattern together with the containment check is caught in compat; reverting the pre-approval scope check (K11) alone, or disabling only the realpath containment (isInside) alone, is NOT caught in compat (reads are also guarded by a second file-level check, and compat writes stop at the approval), only by the modern write probes and the ledger step.',
          'Approval-required tools (swarm plan_squad, project-state state_write/tasks_update) are driven over MRTR: the accept path by the functional steps and decline / no-elicitation by dedicated negatives. memory.* and environment.* tools exist only in project-state with an `environment:` config section, which this journey does not provide, so MRTR with memory.delete is covered by docs/evolution/w10/evidence/k7 (h05-h07), not here.',
          'The compat block speaks initialize 2024-11-05, 2025-06-18 and 2025-11-25 (stdio: one connection per revision, the era is pinned per connection; HTTP: one server, three clients) and repeats the scope negatives; 2025-03-26 is covered by the K7 harness.',
          'No real MCP client (Codex, Claude Code) takes part: the client is this script; real-client proof is K7 section 4.',
        ]
      : [
          'Servers were exercised only in the normal installed mode (NODE_ENV and HSEOS_GOVERNED_EXECUTION_FIXTURE unset) on a v4 state database, i.e. the legacy server path; use --mode modern for the activated database and the 2026-07-28 protocol.',
        ]),
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
