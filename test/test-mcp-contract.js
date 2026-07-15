/**
 * MCP cross-server contract test.
 *
 * The four native servers are hand-rolled JSON-RPC implementations (three on
 * the shared tools/lib/mcp-transport.js, axon-bridge on its own HTTP-only
 * transport). This suite pins the contract they must share:
 *   1. every server reports the SAME protocolVersion — the one exported by
 *      tools/lib/mcp-protocol.js (single source of truth; bump it there only);
 *   2. every server returns serverInfo on initialize;
 *   3. every tool exposes name + description + inputSchema, unique per server.
 *
 * See docs/rfc/2026-07-09-mcp-post-ga-conformance.md for the 2026-07-28 GA
 * upgrade plan this contract protects.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { MCP_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');

const REPO_ROOT = path.join(__dirname, '..');

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

const STDIO_SERVERS = [
  { name: 'hseos-governance', script: path.join(REPO_ROOT, 'tools', 'mcp-hseos-governance', 'index.js') },
  { name: 'hseos-project-state', script: path.join(REPO_ROOT, 'tools', 'mcp-project-state', 'index.js'), withTempDb: true },
  { name: 'hseos-swarm', script: path.join(REPO_ROOT, 'tools', 'mcp-hseos-swarm', 'index.js') },
];

function probeStdio(server) {
  return new Promise((resolve, reject) => {
    const tmp = server.withTempDb ? fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-mcp-contract-')) : null;
    const env = { ...process.env, ...(tmp ? { HSEOS_STATE_DB: path.join(tmp, 'project.db') } : {}) };
    const child = spawn(process.execPath, [server.script], { cwd: REPO_ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', () => {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      try {
        const [init, list] = stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
        resolve({ init: init.result, tools: list.result?.tools || [] });
      } catch (error) {
        reject(new Error(`unparseable stdio output from ${server.name}: ${error.message}`));
      }
    });

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
    child.stdin.end();
  });
}

function httpRpc(port, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(payload));
  });
}

function probeAxonBridgeHttp() {
  const port = 3900 + (process.pid % 90);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'tools', 'mcp-axon-bridge', 'index.js'), `--port=${port}`], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('axon-bridge did not start listening within 10s'));
    }, 10_000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', async (chunk) => {
      if (!chunk.includes('listening')) return;
      clearTimeout(timeout);
      try {
        const init = await httpRpc(port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
        const list = await httpRpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        resolve({ init: init.result, tools: list.result?.tools || [] });
      } catch (error) {
        reject(error);
      } finally {
        child.kill();
      }
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function assertServerContract(name, probe) {
  assertPass(
    `${name}: protocolVersion matches the shared mcp-protocol constant`,
    probe.init?.protocolVersion === MCP_PROTOCOL_VERSION,
    `${probe.init?.protocolVersion} != ${MCP_PROTOCOL_VERSION}`,
  );
  assertPass(`${name}: initialize returns serverInfo.name`, typeof probe.init?.serverInfo?.name === 'string');
  assertPass(`${name}: exposes at least one tool`, probe.tools.length > 0, String(probe.tools.length));
  const names = probe.tools.map((tool) => tool.name);
  assertPass(`${name}: tool names are unique`, new Set(names).size === names.length, names.join(','));
  assertPass(
    `${name}: every tool declares name, description and inputSchema`,
    probe.tools.every((tool) => tool.name && tool.description && tool.inputSchema),
  );
}

(async () => {
  console.log('mcp cross-server contract test');

  const versions = [];
  for (const server of STDIO_SERVERS) {
    const probe = await probeStdio(server);
    assertServerContract(server.name, probe);
    versions.push(probe.init?.protocolVersion);
  }

  const axon = await probeAxonBridgeHttp();
  assertServerContract('axon-bridge (http)', axon);
  versions.push(axon.init?.protocolVersion);

  assertPass('all four servers report an identical protocolVersion', new Set(versions).size === 1, versions.join(','));

  console.log(`\nMCP contract tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-contract] fatal:', error.message);
  process.exit(1);
});
