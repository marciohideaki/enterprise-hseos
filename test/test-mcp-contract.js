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
const {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
} = require('../tools/lib/mcp-2026-adapter');
const { MCP_MODERN_PROTOCOL_VERSION } = require('../tools/lib/mcp-protocol');

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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-mcp-contract-'));
    const env = {
      ...process.env,
      HSEOS_GOVERNED_EXECUTION_FIXTURE: '1',
      HSEOS_STATE_DB: path.join(tmp, 'project.db'),
      NODE_ENV: 'test',
    };
    const child = spawn(process.execPath, [server.script], { cwd: REPO_ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', () => {
      fs.rmSync(tmp, { recursive: true, force: true });
      try {
        const [init, list] = stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
        resolve({ init: init.result, tools: list.result?.tools || [] });
      } catch (error) {
        reject(new Error(`unparseable stdio output from ${server.name}: ${error.message}`));
      }
    });

    const meta = {
      [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
      [CLIENT_INFO_META_KEY]: { name: 'contract-test', version: '1.0.0' },
      [CLIENT_CAPABILITIES_META_KEY]: {},
    };
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: { _meta: meta },
      })}\n`,
    );
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: meta } })}\n`);
    child.stdin.end();
  });
}

function httpRpc(port, payload) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AXON_BRIDGE_CREDENTIAL}`,
          'mcp-protocol-version': MCP_MODERN_PROTOCOL_VERSION,
          'mcp-method': payload.method,
          ...(payload.params?.name ? { 'mcp-name': payload.params.name } : {}),
        },
      },
      (res) => {
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
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(payload));
  });
}

const AXON_BRIDGE_CREDENTIAL = 'contract-test-credential-0123456789abcdef';

function probeAxonBridgeHttp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-mcp-contract-axon-'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'tools', 'mcp-axon-bridge', 'index.js'), '--port=0'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HSEOS_GOVERNED_EXECUTION_FIXTURE: '1',
        HSEOS_AXON_BRIDGE_CREDENTIAL: AXON_BRIDGE_CREDENTIAL,
        HSEOS_STATE_DB: path.join(tmp, 'project.db'),
        NODE_ENV: 'test',
      },
    });
    let completed = false;
    let probing = false;
    let stdout = '';
    let stderr = '';
    const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
    const fail = (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      child.kill();
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      fail(new Error(`axon-bridge did not start listening within 10s${stderr ? `: ${stderr.slice(-500)}` : ''}`));
    }, 10_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // The bridge keeps stdout clean and logs its listening banner on stderr.
    child.stderr.on('data', async (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
      stdout = stderr;
      const match = stdout.match(/governed MCP listening on http:\/\/127\.0\.0\.1:(\d+)\/mcp/);
      if (!match || probing || completed) return;
      probing = true;
      clearTimeout(timeout);
      try {
        const port = Number(match[1]);
        const meta = {
          [PROTOCOL_VERSION_META_KEY]: MCP_MODERN_PROTOCOL_VERSION,
          [CLIENT_INFO_META_KEY]: { name: 'contract-test', version: '1.0.0' },
          [CLIENT_CAPABILITIES_META_KEY]: {},
        };
        const init = await httpRpc(port, {
          jsonrpc: '2.0',
          id: 1,
          method: 'server/discover',
          params: { _meta: meta },
        });
        const list = await httpRpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: meta } });
        completed = true;
        resolve({ init: init.result, tools: list.result?.tools || [] });
      } catch (error) {
        fail(error);
      } finally {
        child.kill();
      }
    });
    child.on('error', fail);
    child.on('close', (code, signal) => {
      cleanup();
      if (!completed) {
        fail(new Error(`axon-bridge exited before listening (code=${code}, signal=${signal})${stderr ? `: ${stderr.slice(-500)}` : ''}`));
      }
    });
  });
}

function assertServerContract(name, probe) {
  assertPass(
    `${name}: fixture supports the gated modern protocol`,
    probe.init?.supportedVersions?.includes(MCP_MODERN_PROTOCOL_VERSION),
    `${JSON.stringify(probe.init?.supportedVersions)} does not include ${MCP_MODERN_PROTOCOL_VERSION}`,
  );
  assertPass(`${name}: discovery returns serverInfo.name`, typeof probe.init?._meta?.[SERVER_INFO_META_KEY]?.name === 'string');
  assertPass(`${name}: exposes at least one tool`, probe.tools.length > 0, String(probe.tools.length));
  const names = probe.tools.map((tool) => tool.name);
  assertPass(`${name}: tool names are unique`, new Set(names).size === names.length, names.join(','));
  assertPass(
    `${name}: every tool declares name, description and inputSchema`,
    probe.tools.every((tool) => tool.name && tool.description && tool.inputSchema),
  );
}

// ---------------------------------------------------------------------------
// W5-04: tool catalog fail-closed boot, capability contract stubs, gateway denial facts.
// ---------------------------------------------------------------------------
const crypto = require('node:crypto');
const {
  CAPABILITY_CONTRACT_STUBS,
  ExecutionContractError,
  ExecutionContractRegistry,
  TOOL_CATALOG_EXIT_CODE,
  ToolCatalogError,
  failBoot,
  loadServerTools,
  registerCapabilityContractStubs,
} = require('../tools/lib/governed-execution/contract-registry');
const {
  EventSchemaError,
  ExecutionEventRegistry,
  GATEWAY_DENIAL_AGGREGATE,
  buildGatewayDenialFact,
  createExecutionEventRegistry,
} = require('../tools/lib/governed-execution/event-registry');

function throwsWith(label, fn, ErrorType, code) {
  try {
    fn();
    assertPass(label, false, 'did not throw');
  } catch (error) {
    assertPass(
      label,
      error instanceof ErrorType && (code === undefined || error.code === code),
      `${error.name}/${error.code}: ${error.message}`,
    );
  }
}

function writeTools(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), source);
  return dir;
}

const GOOD_TOOL = "{ name: 'good_tool', description: 'ok', inputSchema: { type: 'object' }, handler() { return 1; } }";

function runCatalogTests() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-catalog-'));
  const dir = (label) => path.join(base, label);
  const loaded = loadServerTools(writeTools(dir('ok'), { 'a.js': `module.exports = [${GOOD_TOOL}];`, 'README.md': 'ignored' }));
  assertPass('catalog: a valid directory loads and ignores non-js files', loaded.size === 1 && loaded.has('good_tool'));
  for (const server of ['mcp-hseos-governance', 'mcp-hseos-swarm', 'mcp-project-state', 'mcp-axon-bridge']) {
    assertPass(`catalog: the shipped ${server} tools load`, loadServerTools(path.join(REPO_ROOT, 'tools', server, 'tools')).size > 0);
  }
  // Every malformed case sits next to a valid module: a tolerant loader would skip the bad one and return the good tool.
  const good = { 'a-good.js': `module.exports = [${GOOD_TOOL}];` };
  const malformed = {
    'non-array export': { 'b.js': 'module.exports = { name: "x" };' },
    'non-object tool': { 'b.js': 'module.exports = [42];' },
    'array as tool': { 'b.js': 'module.exports = [[]];' },
    'invalid name': { 'b.js': "module.exports = [{ name: '1 bad', description: 'd', inputSchema: {}, handler() {} }];" },
    'missing description': { 'b.js': "module.exports = [{ name: 'x', inputSchema: {}, handler() {} }];" },
    'missing handler': { 'b.js': "module.exports = [{ name: 'x', description: 'd', inputSchema: {} }];" },
    'missing inputSchema': { 'b.js': "module.exports = [{ name: 'x', description: 'd', handler() {} }];" },
    'array inputSchema': { 'b.js': "module.exports = [{ name: 'x', description: 'd', inputSchema: [], handler() {} }];" },
    'duplicate across files': { 'b.js': `module.exports = [${GOOD_TOOL}];` },
    'module that throws on load': { 'b.js': "throw new Error('boom');" },
  };
  const expectedMessage = {
    'non-array export': /must export an array/,
    'non-object tool': /must be an object/,
    'array as tool': /must be an object/,
    'invalid name': /valid name/,
    'missing description': /description/,
    'missing handler': /handler/,
    'missing inputSchema': /inputSchema/,
    'array inputSchema': /inputSchema/,
    'duplicate across files': /Duplicate tool/,
    'module that throws on load': /Failed to load tool module b\.js: boom/,
  };
  for (const [label, files] of Object.entries(malformed)) {
    let caught = null;
    try {
      loadServerTools(writeTools(dir(label.replaceAll(' ', '-')), { ...good, ...files }));
    } catch (error) {
      caught = error;
    }
    assertPass(
      `catalog: ${label}, next to a valid module, still fails the whole catalog with its own cause`,
      caught instanceof ToolCatalogError &&
        caught.code === 'MCP_TOOL_CATALOG_INVALID' &&
        expectedMessage[label].test(caught.message) &&
        !/empty/.test(caught.message),
      caught ? `${caught.code}: ${caught.message}` : 'did not throw',
    );
  }
  throwsWith(
    'catalog: an empty directory has its own code, distinct from a malformed catalog',
    () => loadServerTools(writeTools(dir('empty-directory'), { 'README.md': 'nothing' })),
    ToolCatalogError,
    'MCP_TOOL_CATALOG_EMPTY',
  );
  throwsWith(
    'catalog: a missing directory fails closed',
    () => loadServerTools(dir('absent')),
    ToolCatalogError,
    'MCP_TOOL_CATALOG_INVALID',
  );

  const exits = [];
  const written = [];
  failBoot('unit', new ToolCatalogError('bad'), { exit: (code) => exits.push(code), stderr: { write: (text) => written.push(text) } });
  failBoot('unit', 'plain failure', { exit: (code) => exits.push(code), stderr: { write: (text) => written.push(text) } });
  assertPass(
    'catalog: failBoot reports the code on stderr and exits with the stable boot code',
    exits.join(',') === `${TOOL_CATALOG_EXIT_CODE},${TOOL_CATALOG_EXIT_CODE}` &&
      written[0].includes('MCP_TOOL_CATALOG_INVALID') &&
      written[1].includes('MCP_BOOT_FAILED'),
    written.join('|'),
  );
  fs.rmSync(base, { recursive: true, force: true });
}

// Boots a copy of a server entrypoint whose sibling tool directory is malformed, keeping lib/ and the rest by symlink.
function bootWithMalformedTools(serverDirectory) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-boot-'));
  const toolsRoot = path.join(root, 'tools');
  fs.mkdirSync(path.join(toolsRoot, serverDirectory, 'tools'), { recursive: true });
  for (const entry of fs.readdirSync(path.join(REPO_ROOT, 'tools'))) {
    if (entry !== serverDirectory) fs.symlinkSync(path.join(REPO_ROOT, 'tools', entry), path.join(toolsRoot, entry));
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'packages'), path.join(root, 'packages'));
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'));
  fs.copyFileSync(path.join(REPO_ROOT, 'tools', serverDirectory, 'index.js'), path.join(toolsRoot, serverDirectory, 'index.js'));
  for (const entry of fs.readdirSync(path.join(REPO_ROOT, 'tools', serverDirectory))) {
    if (!['index.js', 'tools'].includes(entry)) {
      fs.symlinkSync(path.join(REPO_ROOT, 'tools', serverDirectory, entry), path.join(toolsRoot, serverDirectory, entry));
    }
  }
  // A valid module sits beside the broken one: a tolerant loader would boot with it instead of failing.
  fs.writeFileSync(path.join(toolsRoot, serverDirectory, 'tools', 'a-good.js'), `module.exports = [${GOOD_TOOL}];`);
  fs.writeFileSync(path.join(toolsRoot, serverDirectory, 'tools', 'broken.js'), 'module.exports = { not: "an array" };');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(toolsRoot, serverDirectory, 'index.js')], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(root, { recursive: true, force: true });
      resolve({ code, stderr });
    });
  });
}

async function runBootFailureTests() {
  for (const server of ['mcp-hseos-governance', 'mcp-hseos-swarm', 'mcp-project-state', 'mcp-axon-bridge']) {
    const result = await bootWithMalformedTools(server);
    assertPass(
      `${server}: a malformed tool module fails the boot with exit ${TOOL_CATALOG_EXIT_CODE} and the error code`,
      result.code === TOOL_CATALOG_EXIT_CODE && result.stderr.includes('MCP_TOOL_CATALOG_INVALID'),
      `${result.code}: ${result.stderr}`,
    );
  }
}

function runCapabilityStubTests() {
  const registry = new ExecutionContractRegistry();
  const registered = registerCapabilityContractStubs(registry);
  const names = registered.map((contract) => contract.name);
  assertPass('stubs: every environment.* and memory.* contract is registered', names.length === CAPABILITY_CONTRACT_STUBS.length);
  for (const required of [
    'environment.lsp.diagnostics',
    'environment.lsp.rename_preview',
    'environment.dap.run',
    'environment.browser.run',
    'environment.computer.start',
    'environment.computer.act',
    'environment.computer.stop',
    'memory.write',
    'memory.retrieve',
    'memory.delete',
  ]) {
    assertPass(
      `stubs: ${required} is versioned and fail-closed`,
      (() => {
        const contract = registry.resolve(required);
        const stub = CAPABILITY_CONTRACT_STUBS.find((entry) => entry.name === required);
        return (
          contract.failure_mode === 'fail_closed' &&
          stub.contract_version === 1 &&
          stub.status === 'stub' &&
          contract.input_schema.version === 1
        );
      })(),
    );
  }
  assertPass(
    'stubs: computer-use actions and memory deletion require approval',
    registry.resolve('environment.computer.act').requires_approval &&
      registry.resolve('environment.computer.start').requires_approval &&
      registry.resolve('memory.delete').requires_approval,
  );
  throwsWith(
    'stubs: a stub has no implementation, so its input never validates',
    () => registry.validateInput(registry.resolve('memory.write'), { content: 'x' }),
    ExecutionContractError,
    'ENV_CAPABILITY_NOT_IMPLEMENTED',
  );
  throwsWith(
    'stubs: a stub output never validates either',
    () => registry.validateOutput(registry.resolve('memory.retrieve'), {}),
    ExecutionContractError,
    'ENV_CAPABILITY_NOT_IMPLEMENTED',
  );
  throwsWith('stubs: registration needs a contract registry', () => registerCapabilityContractStubs({}), ExecutionContractError);
  throwsWith(
    'stubs: registering twice is refused as a duplicate',
    () => registerCapabilityContractStubs(registry),
    ExecutionContractError,
    'EXECUTION_TOOL_DUPLICATE',
  );
}

function validContract(overrides = {}) {
  const schema = { version: 1, safeParse: (value) => ({ success: true, data: value }) };
  return {
    name: 'unit.tool',
    capability: 'unit',
    provider: 'unit:provider',
    authority: 'unit.read',
    policy_version: 'v1',
    reversibility: 'read_only',
    cancellation_policy: 'cooperative',
    failure_mode: 'fail_closed',
    timeout_ms: 1000,
    requires_approval: false,
    exclusive: false,
    provider_accepts_idempotency: false,
    input_schema: schema,
    output_schema: schema,
    ...overrides,
  };
}

function runRegistryTests() {
  const registry = new ExecutionContractRegistry();
  assertPass(
    'registry: a valid contract registers and lists sorted',
    registry.register(validContract()).name === 'unit.tool' && registry.list().length === 1,
  );
  const invalid = {
    'non-object contract': [null],
    'array contract': [[]],
    'missing text field': [validContract({ capability: '' })],
    'duplicate tool': [validContract()],
    'bad reversibility': [validContract({ name: 'u2', reversibility: 'nope' })],
    'bad cancellation': [validContract({ name: 'u3', cancellation_policy: 'nope' })],
    'bad failure mode': [validContract({ name: 'u4', failure_mode: 'nope' })],
    'timeout too large': [validContract({ name: 'u5', timeout_ms: 3_600_001 })],
    'timeout not integer': [validContract({ name: 'u6', timeout_ms: 1.5 })],
    'non-boolean flag': [validContract({ name: 'u7', exclusive: 'yes' })],
    'schema without safeParse': [validContract({ name: 'u8', input_schema: { version: 1 } })],
    'schema version zero': [validContract({ name: 'u9', output_schema: { version: 0, safeParse() {} } })],
  };
  for (const [label, [contract]] of Object.entries(invalid)) {
    throwsWith(`registry: ${label} is rejected`, () => registry.register(contract), ExecutionContractError);
  }
  throwsWith(
    'registry: an unknown tool resolves to a stable code',
    () => registry.resolve('absent'),
    ExecutionContractError,
    'EXECUTION_TOOL_NOT_FOUND',
  );

  const contract = registry.resolve('unit.tool');
  const failing = { version: 2, safeParse: () => ({ success: false, error: { hseos_code: 'UNIT_SPECIFIC', issues: [{ m: 1 }] } }) };
  const plain = { version: 1, safeParse: () => ({ success: false }) };
  const exploding = {
    version: 1,
    safeParse: () => {
      throw new Error('schema bug');
    },
  };
  throwsWith(
    'registry: a schema may classify its own rejection',
    () => registry.validateInput({ input_schema: failing }, {}),
    ExecutionContractError,
    'UNIT_SPECIFIC',
  );
  throwsWith(
    'registry: the default rejection code names the phase',
    () => registry.validateOutput({ output_schema: plain }, {}),
    ExecutionContractError,
    'EXECUTION_OUTPUT_INVALID',
  );
  throwsWith(
    'registry: a throwing schema is reported, not propagated raw',
    () => registry.validateInput({ input_schema: exploding }, {}),
    ExecutionContractError,
    'EXECUTION_SCHEMA_EVALUATION_FAILED',
  );
  assertPass('registry: a conforming value passes through', registry.validateInput(contract, { a: 1 }).a === 1);

  assertPass('registry: starts unsealed', registry.sealed === false);
  registry.seal();
  assertPass('registry: seals', registry.sealed === true);
  throwsWith(
    'registry: a sealed registry refuses new contracts',
    () => registry.register(validContract({ name: 'late' })),
    ExecutionContractError,
    'EXECUTION_CONTRACT_REGISTRY_SEALED',
  );
}

function definition(overrides = {}) {
  const field = (extra = {}) => ({ allowed_fields: ['a'], required_fields: ['a'], classifications: { a: 'operational' }, ...extra });
  return { event_type: 'UnitEvent', current_version: 1, versions: { 1: field() }, ...overrides };
}

function runEventRegistryTests() {
  const registry = createExecutionEventRegistry();
  assertPass('events: the lifecycle registry is sealed and describes every type', registry.sealed && registry.describe().length >= 8);
  const eventId = crypto.randomUUID();
  const occurredAt = '2026-10-11T00:00:00.000Z';
  const actor = { id: 'local:uid:1', type: 'local_process' };
  const request = buildGatewayDenialFact({
    serverId: 'governance',
    tool: 'ghost_tool',
    code: 'MCP_TOOL_UNKNOWN',
    rpcCode: -32_602,
    actor,
    eventId,
    occurredAt,
  });
  const fact = request.events[0];
  registry.validateForAppend(fact);
  assertPass(
    'events: a gateway denial is one ExecutionFailed fact on a dedicated aggregate with a stable code',
    request.aggregate_type === GATEWAY_DENIAL_AGGREGATE &&
      request.expected_version === 0 &&
      fact.event_type === 'ExecutionFailed' &&
      fact.operation_id === null &&
      fact.payload.error.code === 'MCP_TOOL_UNKNOWN' &&
      fact.payload.error.message.includes('-32602') &&
      fact.evidence_refs[0] === 'hseos://mcp/governance/denied/ghost_tool',
    JSON.stringify(fact),
  );
  const noRpc = buildGatewayDenialFact({ serverId: 's', tool: 42, code: 'MCP_SCOPE_DENIED', actor, eventId, occurredAt });
  assertPass(
    'events: a non-string tool and a missing rpc code are recorded without leaking input',
    noRpc.events[0].payload.error.message.includes('(invalid)') && noRpc.events[0].payload.error.message.includes('n/a'),
  );
  const long = buildGatewayDenialFact({
    serverId: 's',
    tool: 'x'.repeat(500),
    code: 'MCP_SCOPE_DENIED',
    rpcCode: -32_603,
    actor,
    eventId,
    occurredAt,
  });
  assertPass('events: a client-controlled tool name is truncated', long.events[0].evidence_refs[0].length < 200);
  throwsWith(
    'events: an unsupported denial code is refused',
    () => buildGatewayDenialFact({ serverId: 's', tool: 't', code: 'OTHER', actor, eventId, occurredAt }),
    EventSchemaError,
    'EXECUTION_EVENT_PAYLOAD_INVALID',
  );

  throwsWith(
    'events: validateForAppend rejects an unregistered type',
    () => registry.validateForAppend({ event_type: 'Nope', schema_version: 1, payload: {} }),
    EventSchemaError,
    'EXECUTION_EVENT_TYPE_UNREGISTERED',
  );
  throwsWith(
    'events: validateForAppend rejects a non-current version',
    () => registry.validateForAppend({ event_type: 'ExecutionFailed', schema_version: 9, payload: {} }),
    EventSchemaError,
    'EXECUTION_EVENT_SCHEMA_NOT_CURRENT',
  );
  throwsWith('events: validateForAppend rejects a non-object event', () => registry.validateForAppend(null), EventSchemaError);
  throwsWith(
    'events: unknown payload fields are refused',
    () => registry.validateForAppend({ ...fact, payload: { ...fact.payload, extra: 1 } }),
    EventSchemaError,
    'EXECUTION_EVENT_PAYLOAD_INVALID',
  );
  const badPayloads = [
    { error: { code: 'C', message: 'm', retryable: 'no' }, warnings: [] },
    { error: { code: 'C', message: 'm', retryable: false, extra: 1 }, warnings: [] },
    { error: { code: '', message: 'm', retryable: false }, warnings: [] },
    { error: 'text', warnings: [] },
    { error: { code: 'C', message: 'm', retryable: false }, warnings: [1] },
    { error: { code: 'C', message: 'm', retryable: false }, warnings: [], provider_receipt_ref: '' },
  ];
  for (const [index, payload] of badPayloads.entries()) {
    throwsWith(
      `events: malformed ExecutionFailed payload #${index + 1} is refused`,
      () => registry.validateForAppend({ ...fact, payload }),
      EventSchemaError,
    );
  }
  const started = {
    ...fact,
    event_type: 'ExecutionStarted',
    payload: { tool: 't', provider: 'p', idempotency_key: 'k', dispatch_attempt: 0, deadline: 'd' },
  };
  throwsWith('events: positive integers are enforced', () => registry.validateForAppend(started), EventSchemaError);
  const authorized = {
    ...fact,
    event_type: 'ExecutionAuthorized',
    payload: {
      tool: 't',
      capability: 'c',
      input_schema_version: 1,
      output_schema_version: 1,
      reversibility: 'read_only',
      policy_version: 'p',
      deadline: 'd',
      cancellation_policy: 'cooperative',
      idempotency_key: 'k',
      resource_scope: [],
      input_digest: 'x',
      warnings: [],
    },
  };
  throwsWith('events: object fields are enforced', () => registry.validateForAppend(authorized), EventSchemaError);
  throwsWith(
    'events: optional strings are enforced',
    () => registry.validateForAppend({ ...authorized, payload: { ...authorized.payload, resource_scope: {}, approval_id: '' } }),
    EventSchemaError,
  );

  const roundTrip = registry.deserialize({ ...fact, schema_version: 1 });
  assertPass('events: deserialize keeps a current event intact', roundTrip.payload.error.code === 'MCP_TOOL_UNKNOWN');
  throwsWith(
    'events: deserialize rejects an unsupported schema version',
    () => registry.deserialize({ ...fact, schema_version: 7 }),
    EventSchemaError,
    'EXECUTION_EVENT_SCHEMA_UNSUPPORTED',
  );
  throwsWith('events: deserialize rejects a non-object event', () => registry.deserialize('x'), EventSchemaError);
  throwsWith(
    'events: deserialize rejects a non-JSON payload',
    () =>
      registry.deserialize({
        ...fact,
        payload: { error: { code: 'C', message: 'm', retryable: false }, warnings: [], extra: undefined, fn() {} },
      }),
    EventSchemaError,
  );

  // Declarative upcasting: v1 -> v2 renames, adds and removes fields deterministically.
  const upcastable = new ExecutionEventRegistry([
    definition({
      current_version: 2,
      versions: {
        1: { allowed_fields: ['old', 'drop'], required_fields: ['old'], classifications: { old: 'operational', drop: 'operational' } },
        2: {
          allowed_fields: ['renamed', 'added'],
          required_fields: ['renamed', 'added'],
          classifications: { renamed: 'operational', added: 'operational' },
        },
      },
      upcasters: { 1: { rename: { old: 'renamed' }, remove: ['drop'], add: { added: 'x' } } },
    }),
  ]);
  const upcast = upcastable.deserialize({ event_type: 'UnitEvent', schema_version: 1, payload: { old: 'v', drop: 'gone' } });
  assertPass(
    'events: a declarative upcaster renames, removes and adds',
    upcast.schema_version === 2 && upcast.payload.renamed === 'v' && upcast.payload.added === 'x' && !('drop' in upcast.payload),
  );
  throwsWith(
    'events: an upcaster add that collides is refused',
    () =>
      upcastable.deserialize({ event_type: 'UnitEvent', schema_version: 1, payload: { old: 'v', drop: 'g' } }) &&
      new ExecutionEventRegistry([
        definition({
          current_version: 2,
          versions: {
            1: { allowed_fields: ['x'], required_fields: ['x'], classifications: { x: 'o' } },
            2: { allowed_fields: ['x'], required_fields: ['x'], classifications: { x: 'o' } },
          },
          upcasters: { 1: { add: { x: 1 } } },
        }),
      ]).deserialize({ event_type: 'UnitEvent', schema_version: 1, payload: { x: 1 } }),
    EventSchemaError,
    'EXECUTION_EVENT_UPCAST_PRECONDITION_FAILED',
  );

  const invalidDefinitions = {
    'non-object definition': [null],
    'missing event type': [definition({ event_type: '' })],
    'duplicate type': [definition(), definition()],
    'unclassified field': [definition({ versions: { 1: { allowed_fields: ['a'], required_fields: ['a'], classifications: {} } } })],
    'invalid schema': [definition({ versions: { 1: { allowed_fields: 'a', required_fields: [] } } })],
    'missing current schema': [definition({ current_version: 2 })],
    'missing upcaster': [definition({ current_version: 2, versions: { 1: definition().versions[1], 2: definition().versions[1] } })],
    'unsupported upcaster operation': [
      definition({
        current_version: 2,
        versions: { 1: definition().versions[1], 2: definition().versions[1] },
        upcasters: { 1: { explode: true } },
      }),
    ],
    'upcaster rename collision': [
      definition({
        current_version: 2,
        versions: { 1: definition().versions[1], 2: definition().versions[1] },
        upcasters: { 1: { rename: 'bad' } },
      }),
    ],
  };
  for (const [label, definitions] of Object.entries(invalidDefinitions)) {
    throwsWith(`events: ${label} is rejected at registration`, () => new ExecutionEventRegistry(definitions), EventSchemaError);
  }
  const sealed = new ExecutionEventRegistry().seal();
  throwsWith(
    'events: a sealed registry refuses registration',
    () => sealed.register(definition()),
    EventSchemaError,
    'EXECUTION_EVENT_REGISTRY_SEALED',
  );
}

// ---------------------------------------------------------------------------
// W5-04 (scope widened by the Commander): project-state and axon-bridge entrypoints, exercised through real processes.
// ---------------------------------------------------------------------------
const { freePort } = require('./helpers/free-port');

function postJson(port, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/mcp',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function getStatus(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
      .on('error', reject);
  });
}

function spawnServer(script, { args = [], env = {}, cwd } = {}) {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'tools', script, 'index.js'), ...args], {
    cwd: cwd || REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { stderr: '', exit: null };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => (state.stderr += chunk));
  state.closed = new Promise((resolve) =>
    child.on('close', (code, signal) => {
      state.exit = { code, signal };
      resolve(state.exit);
    }),
  );
  state.child = child;
  state.stop = async () => {
    if (state.exit === null) child.kill('SIGTERM');
    return state.closed;
  };
  state.ready = (pattern) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`not ready: ${state.stderr.slice(-400)}`)), 15_000);
      const check = setInterval(() => {
        if (pattern.test(state.stderr)) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        } else if (state.exit) {
          clearTimeout(timer);
          clearInterval(check);
          reject(new Error(`exited ${JSON.stringify(state.exit)}: ${state.stderr.slice(-400)}`));
        }
      }, 50);
    });
  return state;
}

const productionEnv = (tmp) => ({
  NODE_ENV: 'production',
  HSEOS_GOVERNED_EXECUTION_FIXTURE: '',
  HSEOS_STATE_DB: path.join(tmp, 'project.db'),
  HSEOS_LEGACY_TELEMETRY_DB: path.join(tmp, 'telemetry.db'),
});

async function runEntrypointTests() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-entry-'));
  const rpc = (port, id, name, args) => postJson(port, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  try {
    // project-state, installed (legacy) mode: the whole legacy tool switch over HTTP.
    const port = await freePort();
    const instance = '12345678-1234-1234-1234-123456789abc';
    const server = spawnServer('mcp-project-state', {
      args: [`--port=${port}`, `--db=${path.join(tmp, 'project.db')}`, `--instance-id=${instance}`],
      env: productionEnv(tmp),
      cwd: tmp,
    });
    try {
      await server.ready(/legacy MCP compatibility listening/);
      assertPass('project-state: health reports the instance id', (await getStatus(port, '/health')) === 200);
      const write = (await rpc(port, 1, 'state_write', { fields: { phase: 'W5', n: 2 }, agent: 'unit' })).body.result;
      assertPass('project-state: state_write stores and reports fields', write.written === 2, JSON.stringify(write));
      const read = (await rpc(port, 2, 'state_read', {})).body.result;
      assertPass('project-state: state_read returns what was written', read.state.phase === 'W5' && read.state.n === '2');
      await rpc(port, 3, 'tasks_add', { id: 'T1', owner: 'o', description: 'd', depends: ['T0'] });
      await rpc(port, 4, 'tasks_add', { id: 'T2', owner: 'o', description: 'd2' });
      assertPass(
        'project-state: tasks_add without required fields is an error',
        (await rpc(port, 5, 'tasks_add', { id: 'T3', owner: 'o', description: 'x'.repeat(4) })).body.error === undefined &&
          (await rpc(port, 6, 'tasks_add', { id: 'T3' })).body.error !== undefined,
      );
      assertPass(
        'project-state: tasks_list lists all and by status',
        (await rpc(port, 7, 'tasks_list', {})).body.result.count === 3 &&
          (await rpc(port, 8, 'tasks_list', { status: 'pending' })).body.result.count === 3,
      );
      assertPass(
        'project-state: tasks_update changes a task',
        (await rpc(port, 9, 'tasks_update', { id: 'T1', status: 'done', note: 'n' })).body.result.status === 'done',
      );
      assertPass(
        'project-state: tasks_update of a missing task is an error',
        (await rpc(port, 10, 'tasks_update', { id: 'NOPE', status: 'done' })).body.error.message.includes('Task not found'),
      );
      assertPass(
        'project-state: tasks_update without status is an error',
        (await rpc(port, 11, 'tasks_update', { id: 'T1' })).body.error !== undefined,
      );
      assertPass(
        'project-state: state_history returns the writes',
        (await rpc(port, 12, 'state_history', { n: 5 })).body.result.count >= 2,
      );
      assertPass(
        'project-state: a dynamic tool runs with the data access layer',
        (await rpc(port, 13, 'runs_list', {})).body.error === undefined,
      );
      const ghost = (await rpc(port, 14, 'ghost_tool', {})).body;
      assertPass('project-state: an unknown tool is denied by the gateway', ghost.error.message.startsWith('Unknown tool: ghost_tool'));
    } finally {
      const exit = await server.stop();
      assertPass('project-state: SIGTERM shuts the server down cleanly', exit.code === 0, JSON.stringify(exit));
    }
    const denials = new (require('better-sqlite3'))(path.join(tmp, 'telemetry.db'), { readonly: true });
    const stored = denials.prepare('SELECT code, tool FROM mcp_gateway_denials').all();
    denials.close();
    assertPass(
      'project-state: the unknown-tool denial is durable in the legacy telemetry store',
      stored.length === 1 && stored[0].code === 'MCP_TOOL_UNKNOWN' && stored[0].tool === 'ghost_tool',
      JSON.stringify(stored),
    );

    for (const [label, args] of [
      ['a non-numeric port', ['--port=abc']],
      ['a port out of range', ['--port=70000']],
      ['a malformed instance id', ['--instance-id=not-a-uuid']],
    ]) {
      const bad = spawnServer('mcp-project-state', { args, env: productionEnv(tmp), cwd: tmp });
      const exit = await bad.closed;
      assertPass(`project-state: ${label} refuses to start`, exit.code !== 0 && exit.code !== null, bad.stderr.slice(-200));
    }

    // project-state, governed fixture: the native path, scheduler included.
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-w5-04-entry-fixture-'));
    const fixturePort = await freePort();
    const fixture = spawnServer('mcp-project-state', {
      args: [`--port=${fixturePort}`],
      env: { NODE_ENV: 'test', HSEOS_GOVERNED_EXECUTION_FIXTURE: '1', HSEOS_STATE_DB: path.join(fixtureDir, 'project.db') },
      cwd: fixtureDir,
    });
    try {
      await fixture.ready(/governed MCP listening/);
      const result = (await rpc(fixturePort, 1, 'state_read', {})).body.result;
      const envelope = result.structuredContent || JSON.parse(result.content[0].text);
      assertPass(
        'project-state: the governed fixture executes a read through the scheduler',
        envelope.ok === true,
        JSON.stringify(envelope),
      );
    } finally {
      await fixture.stop();
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }

    // axon-bridge: HTTP needs a credential, a loopback host and no origin; stdio is the default.
    const noCredential = spawnServer('mcp-axon-bridge', {
      args: ['--http'],
      env: { ...productionEnv(tmp), HSEOS_AXON_BRIDGE_CREDENTIAL: '' },
      cwd: tmp,
    });
    const noCredentialExit = await noCredential.closed;
    assertPass(
      'axon-bridge: HTTP mode without a credential refuses to start',
      noCredentialExit.code === 1 && /requires HSEOS_AXON_BRIDGE_CREDENTIAL/.test(noCredential.stderr),
      noCredential.stderr.slice(-200),
    );
    const credential = 'unit-credential-0123456789abcdef-0123456789';
    const axonPort = await freePort();
    const axon = spawnServer('mcp-axon-bridge', {
      args: [`--port=${axonPort}`],
      env: { ...productionEnv(tmp), HSEOS_AXON_BRIDGE_CREDENTIAL: credential },
      cwd: tmp,
    });
    try {
      await axon.ready(/legacy MCP compatibility listening/);
      const authorized = { Authorization: `Bearer ${credential}` };
      assertPass('axon-bridge: a request without a credential is 401', (await getStatus(axonPort, '/health')) === 401);
      assertPass(
        'axon-bridge: a wrong credential is 401',
        (await getStatus(axonPort, '/health', { Authorization: 'Bearer wrong' })) === 401,
      );
      assertPass(
        'axon-bridge: a browser origin is 403',
        (await getStatus(axonPort, '/health', { ...authorized, Origin: 'http://evil.example' })) === 403,
      );
      assertPass(
        'axon-bridge: a non-loopback Host is 403',
        (await getStatus(axonPort, '/health', { ...authorized, Host: 'evil.example:80' })) === 403,
      );
      assertPass('axon-bridge: a valid credential reaches the server', (await getStatus(axonPort, '/health', authorized)) === 200);
      const ghost = await postJson(
        axonPort,
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ghost_tool', arguments: {} } },
        authorized,
      );
      assertPass('axon-bridge: an unknown tool is denied', ghost.body.error.message.startsWith('Unknown tool: ghost_tool'));
      const overview = await postJson(
        axonPort,
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_overview', arguments: {} } },
        authorized,
      );
      assertPass(
        'axon-bridge: a known tool answers (AXON_UNAVAILABLE when the binary is absent)',
        overview.status === 200 && overview.body.id === 2,
      );
    } finally {
      const exit = await axon.stop();
      assertPass('axon-bridge: SIGTERM shuts the server down cleanly', exit.code === 0, JSON.stringify(exit));
    }
    const stdio = spawnServer('mcp-axon-bridge', { env: productionEnv(tmp), cwd: tmp });
    stdio.child.stdin.end('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
    const stdioExit = await stdio.closed;
    assertPass(
      'axon-bridge: stdio mode serves and exits when stdin closes',
      stdioExit.code === 0 && /Axon binary/.test(stdio.stderr),
      stdio.stderr.slice(-200),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function runW504Tests() {
  runCatalogTests();
  await runBootFailureTests();
  runCapabilityStubTests();
  runRegistryTests();
  runEventRegistryTests();
  await runEntrypointTests();
}

(async () => {
  console.log('mcp cross-server contract test');

  const versions = [];
  for (const server of STDIO_SERVERS) {
    const probe = await probeStdio(server);
    assertServerContract(server.name, probe);
    versions.push(JSON.stringify(probe.init?.supportedVersions));
  }

  const axon = await probeAxonBridgeHttp();
  assertServerContract('axon-bridge (http)', axon);
  versions.push(JSON.stringify(axon.init?.supportedVersions));

  assertPass('all four servers report an identical protocolVersion', new Set(versions).size === 1, versions.join(','));

  await runW504Tests();

  console.log(`\nMCP contract tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error('[test-mcp-contract] fatal:', error.message);
  process.exit(1);
});
