'use strict';

/**
 * Stdio MCP smoke test for HSEOS MCP servers.
 * Verifies stdout is valid line-delimited JSON-RPC and startup logs stay on stderr.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

const SERVERS = [
  {
    name: 'hseos-governance',
    script: path.join(REPO_ROOT, 'tools', 'mcp-hseos-governance', 'index.js'),
    expectedTool: 'query_constitution',
  },
  {
    name: 'hseos-project-state',
    script: path.join(REPO_ROOT, 'tools', 'mcp-project-state', 'index.js'),
    expectedTool: 'runs_list',
    withTempDb: true,
  },
  {
    name: 'hseos-swarm',
    script: path.join(REPO_ROOT, 'tools', 'mcp-hseos-swarm', 'index.js'),
    expectedTool: 'plan_squad',
  },
];

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

function runStdio(server) {
  return new Promise((resolve, reject) => {
    const tmp = server.withTempDb ? fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-mcp-stdio-')) : null;
    const env = {
      ...process.env,
      ...(tmp ? { HSEOS_STATE_DB: path.join(tmp, 'project.db') } : {}),
    };
    const child = spawn(process.execPath, [server.script], {
      cwd: REPO_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', () => {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      resolve({ stdout, stderr });
    });

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
    child.stdin.end();
  });
}

(async () => {
  console.log('mcp stdio smoke test');

  for (const server of SERVERS) {
    await it(`${server.name} initialize + tools/list over stdio`, async () => {
      const { stdout } = await runStdio(server);
      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length !== 2) throw new Error(`expected 2 JSON-RPC lines, got ${lines.length}: ${stdout}`);

      const init = JSON.parse(lines[0]);
      const list = JSON.parse(lines[1]);
      if (init.result?.serverInfo?.name !== server.name) {
        throw new Error(`unexpected server name: ${JSON.stringify(init.result?.serverInfo)}`);
      }
      const tools = list.result?.tools || [];
      if (!tools.some((tool) => tool.name === server.expectedTool)) {
        throw new Error(`missing expected tool: ${server.expectedTool}`);
      }
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-stdio] fatal:', error.message);
  process.exit(1);
});
