// K7: prova ponta a ponta do servidor MCP MODERNO sobre banco ATIVADO, contra o pacote instalado (consumidor descartavel).
//
//   node modern-journey.mjs --modern <consumidor com banco ativado> --control <consumidor com banco v4> \
//        --host <consumidor com OUTRO banco ativado, so para o host> --toolchain <cache> --scratch <dir> --out <dir>
//
// Parte "counts": 4 servidores, stdio e HTTP, em modo moderno (server/discover + tools/list) e como cliente legado
// (initialize 2024-11-05 / 2025-06-18 / 2025-11-25 + tools/list); o controle v4 prova que o legado continua legado.
// Parte "host": project-state moderno com a secao `environment:` (hover LSP real, memory.write/retrieve, restart,
// memory.delete com aprovacao MRTR, cliente legado, ledger, credencial). Nada toca bancos ou configs reais.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : path.resolve(argv[i + 1]);
};
const MODERN = opt('modern');
const CONTROL = opt('control');
const HOST = opt('host');
const TOOLCHAIN = opt('toolchain');
const SCRATCH = opt('scratch');
const OUT = opt('out');
if (![MODERN, CONTROL, HOST, TOOLCHAIN, SCRATCH, OUT].every(Boolean)) {
  throw new Error('usage: modern-journey.mjs --modern D --control D --host D --toolchain D --scratch D --out D');
}
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SCRATCH, { recursive: true });

const pkg = (consumer) => path.join(consumer, 'node_modules', 'hseos');
const requireFrom = createRequire(path.join(pkg(MODERN), 'package.json'));
const adapter = requireFrom('./tools/lib/mcp-2026-adapter.js');
const { MCP_MODERN_PROTOCOL_VERSION } = requireFrom('./tools/lib/mcp-protocol.js');
const { sha256Text } = requireFrom('./packages/agent-memory');
const Database = requireFrom('better-sqlite3');
const yaml = requireFrom('yaml');

const NODE_BIN = path.dirname(process.execPath);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (value) => String(value).split(os.homedir()).join('~');
const BRIDGE_CREDENTIAL = createHash('sha256').update(`k7-${Date.now()}-${process.pid}`).digest('hex');

const SERVERS = [
  { id: 'hseos-governance', dir: 'mcp-hseos-governance' },
  { id: 'hseos-swarm', dir: 'mcp-hseos-swarm' },
  { id: 'hseos-project-state', dir: 'mcp-project-state' },
  { id: 'axon-bridge', dir: 'mcp-axon-bridge' },
];

/** A free loopback port (project-state refuses --port=0). */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

/** One server child, reachable over stdio (JSON lines) or HTTP (POST /mcp). */
async function launch(consumer, server, { transport = 'stdio', config, args = [] } = {}) {
  const cwd = consumer;
  const db = path.join(consumer, '.hseos', 'state', 'project.db');
  const serverArgs = [path.join(pkg(consumer), 'tools', server.dir, 'index.js'), ...args];
  if (server.dir === 'mcp-project-state') serverArgs.push(`--db=${db}`, `--config=${config ?? path.join(SCRATCH, 'absent-config.yaml')}`);
  const fixedPort = transport === 'http' ? await freePort() : null;
  if (fixedPort) serverArgs.push(`--port=${fixedPort}`);
  // PATH sem o axon real: o axon-bridge responde AXON_UNAVAILABLE, como no runner de CI.
  const env = { PATH: `${NODE_BIN}:/usr/bin:/bin`, HOME: os.homedir(), TMPDIR: process.env.TMPDIR || '/build/tmp', HSEOS_STATE_DB: db };
  if (server.dir === 'mcp-axon-bridge') env.HSEOS_AXON_BRIDGE_CREDENTIAL = BRIDGE_CREDENTIAL;
  const child = spawn(process.execPath, serverArgs, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  let buffer = '';
  const waiting = new Map();
  let port = null;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    const m = /127\.0\.0\.1:(\d+)/.exec(stderr);
    if (m) port = Number(m[1]);
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const resolve = waiting.get(message.id);
      if (resolve) {
        waiting.delete(message.id);
        resolve(message);
      }
    }
  });
  const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  if (transport === 'http') {
    for (let i = 0; i < 100 && port === null && child.exitCode === null; i += 1) await sleep(100);
    if (port === null) throw new Error(`HTTP port not announced; stderr=${stderr.slice(0, 400)}`);
  }
  let nextId = 1;
  const client = {
    transport,
    stderr: () => stderr,
    async request(method, params, extraHeaders = {}) {
      const id = nextId++;
      const body = { jsonrpc: '2.0', id, method, params };
      if (transport === 'http') {
        const headers = { 'content-type': 'application/json', ...extraHeaders };
        if (server.dir === 'mcp-axon-bridge') headers.authorization = `Bearer ${BRIDGE_CREDENTIAL}`;
        const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch {
          return { http_status: response.status, body: text.slice(0, 300) };
        }
      }
      const reply = new Promise((resolve, reject) => {
        waiting.set(id, resolve);
        setTimeout(() => reject(new Error(`timeout waiting for ${method}; stderr=${stderr.slice(-400)}`)), 20_000).unref();
      });
      child.stdin.write(`${JSON.stringify(body)}\n`);
      return reply;
    },
    modern(method, params = {}, { capabilities = {}, key } = {}) {
      return client.request(
        method,
        {
          ...params,
          _meta: {
            [adapter.PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
            [adapter.CLIENT_INFO_META_KEY]: { name: 'k7-modern-journey', version: '1.0.0' },
            [adapter.CLIENT_CAPABILITIES_META_KEY]: capabilities,
            ...(key ? { [adapter.HSEOS_IDEMPOTENCY_META_KEY]: key } : {}),
          },
        },
        { 'mcp-protocol-version': MCP_MODERN_PROTOCOL_VERSION, 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}) },
      );
    },
    async close() {
      child.stdin.end();
      child.kill('SIGTERM');
      await Promise.race([exited, sleep(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    },
  };
  return client;
}

const toolNames = (response) => {
  const tools = response?.result?.tools;
  if (Array.isArray(tools)) return tools.map((tool) => tool.name);
  return null;
};

const results = { started_at: new Date().toISOString(), node: process.version, counts: [], host: [] };

// ------------------------------------------------------------------------------------------------ counts
async function countsFor(label, consumer, server, transport, config) {
  const row = {
    label,
    server: server.id,
    transport,
    banco: path.relative(os.homedir(), consumer).startsWith('..') ? '<descartavel>' : consumer,
  };
  const client = await launch(consumer, server, { transport, config });
  try {
    const discover = await client.modern('server/discover');
    row.discover = discover.result
      ? {
          resultType: discover.result.resultType,
          supportedVersions: discover.result.supportedVersions,
          serverInfo: discover.result._meta?.['io.modelcontextprotocol/serverInfo'],
        }
      : { error: discover.error ?? discover };
    const modernList = await client.modern('tools/list');
    const names = toolNames(modernList);
    row.modern = names ? { count: names.length, names } : { error: modernList.error ?? modernList };
  } catch (error) {
    row.error = redact(error.message);
  } finally {
    await client.close();
  }
  // Em stdio a era do protocolo fica fixada por conexao: o cliente legado usa uma conexao propria.
  const legacyClient = await launch(consumer, server, { transport, config });
  try {
    row.legacy_compat = {};
    for (const version of ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']) {
      const init = await legacyClient.request('initialize', {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: 'k7-legacy-client', version: '0.0.1' },
      });
      const list = await legacyClient.request('tools/list', {});
      const legacyNames = toolNames(list);
      row.legacy_compat[version] = {
        initialize: init.result
          ? { negotiated: init.result.protocolVersion, serverInfo: init.result.serverInfo }
          : { error: init.error ?? init },
        tools_list: legacyNames ? { count: legacyNames.length } : { error: list.error ?? list },
      };
    }
  } catch (error) {
    row.error = redact(error.message);
  } finally {
    await legacyClient.close();
  }
  results.counts.push(row);
  const summary = row.modern?.count ?? 'x';
  console.log(
    `${label.padEnd(26)} ${server.id.padEnd(20)} ${transport.padEnd(6)} modern=${summary} legacyclient(2025-06-18)=${row.legacy_compat?.['2025-06-18']?.tools_list?.count ?? 'x'}`,
  );
}

async function runCounts() {
  for (const server of SERVERS) {
    for (const transport of ['stdio', 'http']) await countsFor('ativado/moderno', MODERN, server, transport);
  }
  // project-state com a secao environment: o host de capacidades aparece so aqui
  const config = path.join(SCRATCH, 'counts-config.yaml');
  fs.mkdirSync(path.join(SCRATCH, 'counts-ws'), { recursive: true });
  fs.writeFileSync(
    config,
    yaml.stringify({
      environment: {
        project_id: 'alpha',
        memory: {
          rules: [{ id: 'memory-write', source: 'project', stage: 'allow', decision: 'allow' }],
          operator: { id: 'owner', kind: 'operator' },
        },
      },
    }),
  );
  const projectState = SERVERS.find((s) => s.dir === 'mcp-project-state');
  for (const transport of ['stdio', 'http']) await countsFor('ativado+environment', MODERN, projectState, transport, config);
  for (const server of SERVERS) await countsFor('controle v4/legado', CONTROL, server, 'stdio');
}

// ------------------------------------------------------------------------------------------------ host
const note = (overrides = {}) => {
  const content = 'the deploy pipeline uses blue green rollouts';
  return {
    scope: { project_id: 'alpha' },
    memory_id: 'note-1',
    content,
    source_digest: sha256Text(content),
    classification: 'internal',
    source_ref: 'doc://runbook/deploy',
    ttl_seconds: 3600,
    ...overrides,
  };
};
const body = (response) => response?.result?.structuredContent;
const ELICITATION = { elicitation: {} };
const ACCEPT = { confirm: { action: 'accept', content: { approved: true } } };

function ledger(dbPath, aggregateType) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare('SELECT event_type, payload_json FROM execution_events WHERE aggregate_type = ? ORDER BY position')
      .all(aggregateType)
      .map((row) => ({ type: row.event_type, payload_json: row.payload_json }));
  } finally {
    db.close();
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function countBy(rows) {
  const counts = {};
  for (const row of rows) counts[row.type] = (counts[row.type] ?? 0) + 1;
  return counts;
}

async function runHost() {
  const projectState = SERVERS.find((s) => s.dir === 'mcp-project-state');
  const dbPath = path.join(HOST, '.hseos', 'state', 'project.db');
  const main = path.join(SCRATCH, 'host-main');
  const workspace = path.join(main, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, 'index.ts'),
    'function calculate(n: number): number { return n + 1; } module.exports = calculate;\n',
  );
  fs.writeFileSync(path.join(main, 'manifest.json'), '{}');
  const config = path.join(SCRATCH, 'host-config.yaml');
  fs.writeFileSync(
    config,
    yaml.stringify({
      environment: {
        project_id: 'alpha',
        toolchain_cache: TOOLCHAIN,
        memory: {
          rules: [{ id: 'memory-write', source: 'project', stage: 'allow', decision: 'allow' }],
          operator: { id: 'owner', kind: 'operator' },
        },
        workspace: { host_workspace: workspace, main_checkout: main, protected_paths: [path.join(main, 'manifest.json')] },
      },
    }),
  );
  const steps = results.host;
  const record = async (id, title, fn) => {
    const entry = { id, title, status: 'PASS' };
    try {
      const detail = await fn();
      if (detail) entry.detail = detail;
    } catch (error) {
      entry.status = 'FAIL';
      entry.cause = redact(error.message).slice(0, 700);
    }
    steps.push(entry);
    console.log(`${entry.status.padEnd(5)} ${id} ${title}${entry.cause ? ` -- ${entry.cause.slice(0, 160)}` : ''}`);
  };

  let client = await launch(HOST, projectState, { config });
  try {
    await record('h01', 'tools/list moderno anuncia memory.* e environment.lsp.*; computer/browser seguem desligados', async () => {
      const names = toolNames(await client.modern('tools/list'));
      for (const wanted of ['memory.write', 'memory.retrieve', 'memory.delete', 'environment.lsp.hover', 'environment.dap.run'])
        expect(names.includes(wanted), `missing ${wanted}`);
      for (const absent of ['environment.computer.act', 'environment.browser.run']) expect(!names.includes(absent), `${absent} advertised`);
      return { count: names.length, environment_and_memory: names.filter((n) => /^(memory|environment)\./.test(n)) };
    });

    await record('h02', 'environment.lsp.hover real (typescript-language-server do cache pinado)', async () => {
      const hover = await client.modern('tools/call', {
        name: 'environment.lsp.hover',
        arguments: { action: 'hover', language: 'typescript', file: 'index.ts', position: { line: 0, character: 10 } },
      });
      expect(body(hover)?.ok === true, `hover not ok: ${JSON.stringify(hover).slice(0, 400)}`);
      expect(/calculate/.test(JSON.stringify(body(hover).data)), 'hover does not mention calculate');
      return { ok: true, hover_data_excerpt: JSON.stringify(body(hover).data).slice(0, 240) };
    });

    await record('h03', 'memory.write -> memory.retrieve (include_untrusted)', async () => {
      const wrote = await client.modern('tools/call', { name: 'memory.write', arguments: note() });
      expect(body(wrote)?.ok === true, `write failed: ${JSON.stringify(wrote).slice(0, 400)}`);
      const found = await client.modern('tools/call', {
        name: 'memory.retrieve',
        arguments: { project_id: 'alpha', query: 'blue green', include_untrusted: true },
      });
      const sources = body(found)?.data?.result ?? [];
      expect(sources.length === 1, `retrieve count ${sources.length}`);
      expect(sources[0].authority === 'data', 'authority is not data');
      return { retrieved: sources.length, authority: sources[0].authority };
    });

    await client.close();
    client = await launch(HOST, projectState, { config });
    await record('h04', 'memory duravel: retrieve depois de reiniciar o servidor (novo processo, mesmo project.db)', async () => {
      const found = await client.modern('tools/call', {
        name: 'memory.retrieve',
        arguments: { project_id: 'alpha', query: 'blue green', include_untrusted: true },
      });
      const sources = body(found)?.data?.result ?? [];
      expect(sources.length === 1, `after restart count ${sources.length}`);
      return { retrieved_after_restart: sources.length };
    });

    const args = { project_id: 'alpha', memory_id: 'note-1', reason: 'obsolete' };
    const retrieveCount = async () =>
      (
        body(
          await client.modern('tools/call', {
            name: 'memory.retrieve',
            arguments: { project_id: 'alpha', query: 'blue green', include_untrusted: true },
          }),
        )?.data?.result ?? []
      ).length;

    await record('h05', 'memory.delete: input_required; decline NAO apaga', async () => {
      const pending = await client.modern(
        'tools/call',
        { name: 'memory.delete', arguments: args },
        { capabilities: ELICITATION, key: 'del-1' },
      );
      expect(pending.result?.resultType === 'input_required', `not input_required: ${JSON.stringify(pending).slice(0, 300)}`);
      expect((await retrieveCount()) === 1, 'asking deleted the memory');
      const declined = await client.modern(
        'tools/call',
        {
          name: 'memory.delete',
          arguments: args,
          requestState: pending.result.requestState,
          inputResponses: { confirm: { action: 'decline' } },
        },
        { capabilities: ELICITATION, key: 'del-1' },
      );
      expect(declined.error || body(declined)?.ok === false, 'decline did not refuse');
      expect((await retrieveCount()) === 1, 'decline deleted the memory');
      return { resultType: pending.result.resultType, after_decline_count: 1 };
    });

    await record('h06', 'memory.delete: accept apaga', async () => {
      const fresh = await client.modern(
        'tools/call',
        { name: 'memory.delete', arguments: args },
        { capabilities: ELICITATION, key: 'del-2' },
      );
      expect(fresh.result?.resultType === 'input_required', 'fresh delete not input_required');
      const done = await client.modern(
        'tools/call',
        { name: 'memory.delete', arguments: args, requestState: fresh.result.requestState, inputResponses: ACCEPT },
        { capabilities: ELICITATION, key: 'del-2' },
      );
      expect(body(done)?.ok === true, `accept failed: ${JSON.stringify(done).slice(0, 300)}`);
      expect((await retrieveCount()) === 0, 'memory still present after accept');
      return { after_accept_count: 0 };
    });

    await record(
      'h07',
      'cliente legado (initialize 2025-06-18) -> memory.delete = MCP_LEGACY_APPROVAL_UNSUPPORTED e nada apagado',
      async () => {
        expect(
          body(await client.modern('tools/call', { name: 'memory.write', arguments: note({ memory_id: 'note-2' }) }))?.ok === true,
          'rewrite failed',
        );
        // a era do protocolo fica fixada por conexao stdio: o cliente legado abre uma conexao propria
        const legacy = await launch(HOST, projectState, { config });
        let init;
        let called;
        try {
          init = await legacy.request('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'codex-mcp-client', version: '0.163.0' },
          });
          expect(init.result?.protocolVersion === '2024-11-05', `negotiated ${init.result?.protocolVersion}`);
          called = await legacy.request('tools/call', { name: 'memory.delete', arguments: { project_id: 'alpha', memory_id: 'note-2' } });
        } finally {
          await legacy.close();
        }
        expect(
          called.result?.structuredContent?.error?.code === 'MCP_LEGACY_APPROVAL_UNSUPPORTED',
          `got ${JSON.stringify(called).slice(0, 300)}`,
        );
        const stillThere = (
          body(
            await client.modern('tools/call', {
              name: 'memory.retrieve',
              arguments: { project_id: 'alpha', query: 'blue green', include_untrusted: true },
            }),
          )?.data?.result ?? []
        ).length;
        expect(stillThere === 1, 'legacy client deleted something');
        return { negotiated: init.result.protocolVersion, code: 'MCP_LEGACY_APPROVAL_UNSUPPORTED' };
      },
    );

    const secret = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    await record('h08', 'credencial na memoria e recusada e nunca chega ao ledger', async () => {
      const leaking = note({ memory_id: 'leak-1', content: `the key is ${secret}` });
      leaking.source_digest = sha256Text(leaking.content);
      const refused = await client.modern('tools/call', { name: 'memory.write', arguments: leaking });
      expect(body(refused)?.ok === false, `credential accepted: ${JSON.stringify(refused).slice(0, 300)}`);
      return { refused: true };
    });

    await client.close();
    client = null;
    await record('h09', 'ledger do project.db ativado: eventos agent_memory e environment_session; credencial ausente', async () => {
      const memory = ledger(dbPath, 'agent_memory');
      const session = ledger(dbPath, 'environment_session');
      const all = JSON.stringify([memory, session]);
      expect(!all.includes(secret), 'credential found in the ledger');
      expect(
        memory.some((e) => e.type === 'memory.written'),
        'no memory.written',
      );
      expect(
        memory.some((e) => e.type === 'memory.deleted'),
        'no memory.deleted',
      );
      expect(session.length > 0, 'no environment_session event');
      return { agent_memory: countBy(memory), environment_session: countBy(session), credential_in_ledger: false };
    });

    await record('h10', 'controle: sem a secao environment: nenhuma capability anunciada', async () => {
      const bare = await launch(HOST, projectState, { config: path.join(SCRATCH, 'absent-config.yaml') });
      try {
        const names = toolNames(await bare.modern('tools/list'));
        const capability = names.filter((n) => /^(memory|environment)\./.test(n));
        expect(capability.length === 0, `advertised ${capability.join(',')}`);
        const called = await bare.modern('tools/call', { name: 'memory.retrieve', arguments: { project_id: 'alpha', query: 'x' } });
        expect(called.error, 'unadvertised capability did not error');
        return { advertised: 0, error: called.error.message?.slice(0, 120) };
      } finally {
        await bare.close();
      }
    });
  } finally {
    if (client) await client.close();
  }
}

// ------------------------------------------------------------------------------------------------ main
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : 'counts,host';
if (only.includes('counts')) await runCounts();
if (only.includes('host')) await runHost();
results.finished_at = new Date().toISOString();
const failed = results.host.filter((s) => s.status !== 'PASS').length + results.counts.filter((r) => r.error).length;
results.verdict = failed === 0 ? 'PASS' : 'FAIL';
fs.writeFileSync(path.join(OUT, 'modern-journey-result.json'), redact(JSON.stringify(results, null, 2)));
console.log(`verdict: ${results.verdict}`);
process.exitCode = failed === 0 ? 0 : 1;
