'use strict';

/**
 * MCP round-trip test for mcp-axon-bridge.
 * Verifies that an absent or incompatible axon is an explicit, distinguishable
 * error (never an empty success), that a compatible axon is really called, and
 * that the HTTP surface is authenticated while stdio stdout stays protocol-only.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { MCP_LEGACY_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');

const REPO_ROOT = path.join(__dirname, '..');
const SERVER = path.join(REPO_ROOT, 'tools', 'mcp-axon-bridge', 'index.js');

let pass = 0;
let fail = 0;

async function it(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    pass++;
  } catch (error) {
    console.log(`  \u2717 ${name}\n    ${error.message}`);
    fail++;
  }
}

function waitForServerPort(child, { timeoutMs = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error(`timeout waiting for server port${output ? `: ${output.slice(-500)}` : ''}`)),
      timeoutMs,
    );
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-2000);
      const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    };
    child.stderr.on('data', onData);
    child.stdout.on('data', (chunk) => {
      clearTimeout(timeout);
      reject(new Error(`stdout must stay clean, got: ${String(chunk).slice(0, 200)}`));
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`server exited before listening (code=${code}, signal=${signal})${output ? `: ${output.slice(-500)}` : ''}`));
    });
  });
}

const CREDENTIAL = 'axon-bridge-test-credential-0123456789abcdef';

function rpc(port, method, params = {}, { token = CREDENTIAL, raw = false } = {}) {
  const normalizedParams =
    method === 'initialize'
      ? { protocolVersion: MCP_LEGACY_PROTOCOL_VERSION, clientInfo: { name: 'axon-test', version: '1.0.0' }, ...params }
      : params;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: normalizedParams });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        timeout: 8000,
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (chunks += d));
        res.on('end', () => {
          try {
            if (raw) return resolve({ status: res.statusCode, body: chunks });
            const r = JSON.parse(chunks);
            if (r.error) return reject(new Error(`${method}: ${r.error.message}`));
            resolve(r.result);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function toolData(result) {
  const envelope = result.structuredContent || JSON.parse(result.content[0].text);
  if (!Object.hasOwn(envelope, 'ok')) return envelope;
  if (!envelope.ok) throw new Error(`${envelope.error.code}: ${envelope.error.message}`);
  return envelope.data.result;
}

function waitFor(predicate, { timeoutMs = 6000, intervalMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = async () => {
      try {
        if (await predicate()) return resolve();
      } catch {
        /* swallow */
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error('timeout waiting for server'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function writeFakeAxon(dir, mode) {
  const file = path.join(dir, `fake-axon-${mode}`);
  const script = `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('axon 9.9.9 (fake)'); process.exit(0); }
if (${JSON.stringify(mode)} === 'incompatible' || args[0] !== 'serve') { console.log('axon usage: no such subcommand'); process.exit(1); }
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake', version: '9' }, capabilities: {} } }));
  if (m.method === 'tools/call') console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({ echoed_tool: m.params.name, echoed_args: m.params.arguments }) }] } }));
});
`;
  fs.writeFileSync(file, script, { mode: 0o755 });
  return file;
}

function startHttp(env, extraArgs = ['--port=0']) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-axon-state-'));
  const child = spawn(process.execPath, [SERVER, ...extraArgs], {
    cwd: stateDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HSEOS_STATE_DB: path.join(stateDir, 'project.db'), NODE_ENV: 'production', ...env },
  });
  const stop = async () => {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    if (!child.killed) child.kill('SIGKILL');
    fs.rmSync(stateDir, { recursive: true, force: true });
  };
  return { child, stop, stateDir };
}

async function callTool(port, name, args) {
  const body = await rpc(port, 'tools/call', { name, arguments: args }, { raw: true });
  return JSON.parse(body.body);
}

(async () => {
  console.log('mcp-axon-bridge test');

  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-axon-fake-'));
  const NO_AXON_ENV = { AXON_BIN: '/nonexistent-axon-binary', PATH: '/nonexistent-path-dir', HSEOS_AXON_BRIDGE_CREDENTIAL: CREDENTIAL };
  const TOOL_CASES = [
    { name: 'code_search', arguments: { query: 'test query' } },
    { name: 'dep_graph', arguments: { files: ['src/index.js'] } },
    { name: 'memory_search', arguments: { query: 'test memory' } },
    { name: 'get_skeleton', arguments: { files: ['src/index.js'] } },
    { name: 'get_overview', arguments: {} },
    { name: 'run_pipeline', arguments: {} },
  ];

  // --- axon absent: explicit AXON_UNAVAILABLE, never an empty success -----------------
  let srv = startHttp(NO_AXON_ENV);
  try {
    const port = await waitForServerPort(srv.child);
    await waitFor(async () => Array.isArray((await rpc(port, 'tools/list', {})).tools));

    await it('tools/list returns 6 tools', async () => {
      const r = await rpc(port, 'tools/list', {});
      const names = new Set(r.tools.map((t) => t.name));
      for (const { name } of TOOL_CASES) if (!names.has(name)) throw new Error(`missing tool: ${name}`);
      if (r.tools.length !== 6) throw new Error(`expected 6 tools, got ${r.tools.length}`);
    });

    await it('initialize handshake', async () => {
      const r = await rpc(port, 'initialize', {});
      if (r.serverInfo?.name !== 'axon-bridge') throw new Error(`unexpected serverInfo: ${JSON.stringify(r.serverInfo)}`);
    });

    for (const { name, arguments: args } of TOOL_CASES) {
      await it(`${name} fails with AXON_UNAVAILABLE when axon is absent`, async () => {
        const response = await callTool(port, name, args);
        if (!response.error) throw new Error(`expected an error, got ${JSON.stringify(response).slice(0, 200)}`);
        if (!response.error.message.startsWith('AXON_UNAVAILABLE')) throw new Error(`unexpected error: ${response.error.message}`);
        if (JSON.stringify(response).includes('"fallback"')) throw new Error('response still carries a fallback marker');
      });
    }

    await it('HTTP rejects requests without credential (401)', async () => {
      const r = await rpc(port, 'tools/list', {}, { token: null, raw: true });
      if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
    });

    await it('HTTP rejects a wrong credential (401)', async () => {
      const r = await rpc(port, 'tools/list', {}, { token: 'x'.repeat(40), raw: true });
      if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
    });

    await it('HTTP rejects a non-loopback Host header (403)', async () => {
      const status = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/mcp',
            method: 'POST',
            headers: { Host: 'evil.example:80', Authorization: `Bearer ${CREDENTIAL}` },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          },
        );
        req.on('error', reject);
        req.end('{}');
      });
      if (status !== 403) throw new Error(`expected 403, got ${status}`);
    });

    await it('/health is not served without credential', async () => {
      const status = await new Promise((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port, path: '/health' }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
          })
          .on('error', reject);
      });
      if (status !== 401) throw new Error(`expected 401, got ${status}`);
    });
  } finally {
    await srv.stop();
  }

  // --- HTTP mode refuses to start without a strong credential -------------------------
  await it('HTTP mode refuses to start without HSEOS_AXON_BRIDGE_CREDENTIAL', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-axon-cred-'));
    try {
      const env = { ...process.env, HSEOS_STATE_DB: path.join(dir, 'p.db') };
      delete env.HSEOS_AXON_BRIDGE_CREDENTIAL;
      for (const credential of [undefined, 'short']) {
        const result = require('node:child_process').spawnSync(process.execPath, [SERVER, '--port=0'], {
          cwd: dir,
          env: credential ? { ...env, HSEOS_AXON_BRIDGE_CREDENTIAL: credential } : env,
          encoding: 'utf8',
          timeout: 6000,
        });
        if (result.status !== 1) throw new Error(`expected exit 1, got ${result.status} (${result.stderr})`);
        if (!/HSEOS_AXON_BRIDGE_CREDENTIAL/.test(result.stderr)) throw new Error('missing guidance on stderr');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // --- axon with an incompatible interface: AXON_INCOMPATIBLE + detected version -------
  srv = startHttp({
    AXON_BIN: writeFakeAxon(fakeDir, 'incompatible'),
    PATH: '/nonexistent-path-dir',
    HSEOS_AXON_BRIDGE_CREDENTIAL: CREDENTIAL,
  });
  try {
    const port = await waitForServerPort(srv.child);
    await it('incompatible axon yields AXON_INCOMPATIBLE with the detected version', async () => {
      const response = await callTool(port, 'get_overview', {});
      const message = response.error?.message || '';
      if (!message.startsWith('AXON_INCOMPATIBLE')) throw new Error(`unexpected response: ${JSON.stringify(response).slice(0, 300)}`);
      if (!message.includes('axon 9.9.9')) throw new Error(`version not reported: ${message}`);
    });
  } finally {
    await srv.stop();
  }

  // --- axon compatible (controlled fake speaking MCP over `axon serve`) ----------------
  srv = startHttp({ AXON_BIN: writeFakeAxon(fakeDir, 'good'), PATH: '/nonexistent-path-dir', HSEOS_AXON_BRIDGE_CREDENTIAL: CREDENTIAL });
  try {
    const port = await waitForServerPort(srv.child);
    await it('compatible axon is really called with the upstream tool name and arguments', async () => {
      const response = await callTool(port, 'dep_graph', { files: ['a.js'] });
      const data = JSON.parse(response.result.content[0].text);
      if (data.echoed_tool !== 'get_impact_graph') throw new Error(`wrong upstream tool: ${JSON.stringify(data)}`);
      if (JSON.stringify(data.echoed_args) !== JSON.stringify({ files: ['a.js'] })) throw new Error(`wrong args: ${JSON.stringify(data)}`);
    });
    await it('code_search maps to get_context_capsule and memory_search to search_memory', async () => {
      const a = JSON.parse((await callTool(port, 'code_search', { query: 'q' })).result.content[0].text);
      const b = JSON.parse((await callTool(port, 'memory_search', { query: 'q' })).result.content[0].text);
      if (a.echoed_tool !== 'get_context_capsule' || b.echoed_tool !== 'search_memory') throw new Error(JSON.stringify({ a, b }));
    });
  } finally {
    await srv.stop();
  }

  // --- real axon on PATH: must never answer with an empty success ----------------------
  const realAxon = require('node:child_process').spawnSync('which', ['axon'], { encoding: 'utf8' }).stdout.trim();
  if (realAxon) {
    const emptyProject = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-axon-real-'));
    srv = startHttp({ AXON_BIN: realAxon, HSEOS_AXON_BRIDGE_CREDENTIAL: CREDENTIAL });
    try {
      const port = await waitForServerPort(srv.child);
      await it('real axon: unindexed project is an explicit AXON_TOOL_ERROR, not a silent empty result', async () => {
        const response = await callTool(port, 'get_overview', {});
        const message = response.error?.message || '';
        if (!message.startsWith('AXON_TOOL_ERROR')) throw new Error(`unexpected response: ${JSON.stringify(response).slice(0, 300)}`);
      });
    } finally {
      await srv.stop();
      fs.rmSync(emptyProject, { recursive: true, force: true });
    }
  } else {
    console.log('  - real axon not on PATH: real-binary case skipped');
  }

  // --- client robustness (in-process): early exit and child that ignores SIGTERM ------
  const clientPath = process.env.AXON_CLIENT_PATH || path.join(REPO_ROOT, 'tools', 'mcp-axon-bridge', 'lib', 'axon-client.js');
  const { callAxon } = require(clientPath);

  await it('axon that exits immediately yields AXON_INCOMPATIBLE and does not crash on EPIPE', async () => {
    const early = path.join(fakeDir, 'fake-axon-early-exit');
    fs.writeFileSync(early, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    let caught = null;
    const onUncaught = (error) => {
      caught = error;
    };
    process.once('uncaughtException', onUncaught);
    let outcome;
    try {
      outcome = await callAxon(early, 'get_overview', {}, { timeoutMs: 5000 }).then(
        () => 'resolved',
        (error) => error,
      );
      await new Promise((r) => setTimeout(r, 300)); // let a late EPIPE surface
    } finally {
      process.removeListener('uncaughtException', onUncaught);
    }
    if (caught) throw new Error(`unhandled error escaped: ${caught.message}`);
    if (outcome === 'resolved' || !String(outcome.message).startsWith('AXON_INCOMPATIBLE')) {
      throw new Error(`unexpected outcome: ${outcome === 'resolved' ? 'resolved' : outcome.message}`);
    }
  });

  await it('timeout kills a child that ignores SIGTERM and never blocks the event loop', async () => {
    const pidFile = path.join(fakeDir, 'stubborn.pid');
    const stubborn = path.join(fakeDir, 'fake-axon-stubborn');
    fs.writeFileSync(
      stubborn,
      `#!${process.execPath}
process.on('SIGTERM', () => {});
if (process.argv[2] === 'serve') require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`,
      { mode: 0o755 },
    );
    let last = Date.now();
    let maxGap = 0;
    const ticker = setInterval(() => {
      const now = Date.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 50);
    let outcome;
    try {
      outcome = await callAxon(stubborn, 'get_overview', {}, { timeoutMs: 400 }).then(
        () => 'resolved',
        (error) => error,
      );
    } finally {
      clearInterval(ticker);
    }
    if (outcome === 'resolved' || !String(outcome.message).startsWith('AXON_TIMEOUT')) {
      throw new Error(`expected AXON_TIMEOUT, got ${outcome === 'resolved' ? 'resolved' : outcome.message}`);
    }
    if (maxGap > 400) throw new Error(`event loop blocked for ${maxGap}ms`);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    await waitFor(
      () => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      },
      { timeoutMs: 3000 },
    ).catch(() => {
      process.kill(pid, 'SIGKILL');
      throw new Error(`child ${pid} survived (orphan)`);
    });
  });

  await it('consecutive and concurrent calls never overlap axon processes (index lock released before resolve)', async () => {
    const lock = path.join(fakeDir, 'index.lock');
    const lockFake = path.join(fakeDir, 'fake-axon-lock');
    fs.writeFileSync(
      lockFake,
      `#!${process.execPath}
const fs = require('node:fs');
const lock = ${JSON.stringify(lock)};
if (process.argv[2] === '--version') { console.log('axon 9.9.9 (fake)'); process.exit(0); }
let held = true;
try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); } catch { held = false; }
// slow shutdown: the lock is only released 300ms after SIGTERM, like a DuckDB flush
process.on('SIGTERM', () => setTimeout(() => { if (held) fs.unlinkSync(lock); process.exit(0); }, 300));
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake', version: '9' }, capabilities: {} } }));
  if (m.method === 'tools/call') {
    const text = held ? JSON.stringify({ ok: true }) : JSON.stringify({ error: 'Axon index database unavailable' });
    console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { isError: !held, content: [{ type: 'text', text }] } }));
  }
});
`,
      { mode: 0o755 },
    );
    const outcomes = [];
    for (let i = 0; i < 3; i++)
      outcomes.push(
        await callAxon(lockFake, 'get_overview', {}, { timeoutMs: 5000 }).then(
          () => 'ok',
          (error) => error.message,
        ),
      );
    outcomes.push(
      ...(await Promise.all(
        [0, 1, 2].map(() =>
          callAxon(lockFake, 'get_overview', {}, { timeoutMs: 5000 }).then(
            () => 'ok',
            (error) => error.message,
          ),
        ),
      )),
    );
    if (outcomes.some((o) => o !== 'ok')) throw new Error(`lock contention: ${JSON.stringify(outcomes)}`);
    if (fs.existsSync(lock)) throw new Error('lock still held after the last call resolved');
  });

  // --- stdio mode: stdout carries protocol only ----------------------------------------
  await it('stdio mode: no banner on stdout, tools/list answered, errors explicit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-axon-stdio-'));
    const child = spawn(process.execPath, [SERVER], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...NO_AXON_ENV, HSEOS_STATE_DB: path.join(dir, 'p.db') },
    });
    try {
      const lines = [];
      const rl = readline.createInterface({ input: child.stdout });
      rl.on('line', (line) => lines.push(line));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_overview', arguments: {} } })}\n`,
      );
      await waitFor(() => lines.length >= 2);
      for (const line of lines) JSON.parse(line); // throws on any non-JSON (banner) line
      const second = JSON.parse(lines[1]);
      if (!second.error?.message.startsWith('AXON_UNAVAILABLE')) throw new Error(lines[1]);
    } finally {
      child.kill('SIGTERM');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  fs.rmSync(fakeDir, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-axon-bridge] fatal:', error.message);
  process.exit(1);
});
