'use strict';

/**
 * G1: every environment.* and memory.* contract publishes a JSON Schema 2020-12 of its input, next to the contract. The
 * programmatic validator stays the source of truth; the schema is for the client. This test pins the two together: the
 * schema compiles, every input the schema accepts is accepted by the validator, and a wrongly typed input (the campaign
 * case: `scope` as a string, `ttl_seconds` as a string) is refused by both.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const Ajv2020 = require('ajv/dist/2020');

const { sha256Text } = require('../packages/agent-memory');

const {
  CAPABILITY_CONTRACTS,
  ENVIRONMENT_CONTRACTS,
  ExecutionContractRegistry,
  registerCapabilityContractStubs,
} = require('../tools/lib/governed-execution/contract-registry');
const { capabilityToolDescriptors } = require('../tools/lib/governed-execution/operational-runtime');

const ALL = [...ENVIRONMENT_CONTRACTS, ...CAPABILITY_CONTRACTS];
const byName = new Map(ALL.map((contract) => [contract.name, contract]));
// The same options as the MCP adapter, which compiles every published schema when it registers the tool.
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
const compiled = new Map();
const jsonValidator = (name) => {
  if (!compiled.has(name)) compiled.set(name, ajv.compile(byName.get(name).input_json_schema));
  return compiled.get(name);
};
const programmatic = (name, input) => byName.get(name).input_schema.safeParse(input).success === true;
const viaJson = (name, input) => jsonValidator(name)(input) === true;

const CONTENT = 'the build needs node 24';
const SHA = sha256Text(CONTENT);
const MEMORY_ENTRY = {
  memory_id: 'note-1',
  scope: { project_id: 'alpha' },
  content: CONTENT,
  classification: 'internal',
  source_ref: 'hseos://notes/1',
  ttl_seconds: 3600,
};
const LSP_FILE = { language: 'typescript', file: 'src/a.ts' };
const LSP_POS = { position: { line: 1, character: 2 } };
const DAP_BASE = { runtime: 'node', launch: { program: 'app.js' } };
const BROWSER_BASE = { steps: [{ op: 'goto', url: 'https://example.com/a' }] };
const SESSION = { session_id: 'sess-1' };

// Inputs both the schema and the validator must accept.
const VALID = {
  'memory.write': [
    MEMORY_ENTRY,
    { ...MEMORY_ENTRY, supersedes: 'note-0', source_digest: SHA, authority: 'data' },
    { ...MEMORY_ENTRY, ttl_seconds: 7_776_000 },
    { ...MEMORY_ENTRY, origin: 'agent', trust: 'untrusted' },
    // The validator reads an explicit null as omitted, so the schema must accept it.
    { ...MEMORY_ENTRY, source_digest: null, origin: null, trust: null },
    { ...MEMORY_ENTRY, origin: 'operator', trust: 'trusted' },
  ],
  'memory.retrieve': [
    { project_id: 'alpha', query: 'node' },
    { project_id: 'alpha', query: 'node', limit: 50, include_untrusted: true },
  ],
  'memory.delete': [
    { project_id: 'alpha', memory_id: 'note-1' },
    { project_id: 'alpha', memory_id: 'note-1', reason: 'stale' },
  ],
  'environment.lsp.diagnostics': [
    { action: 'diagnostics', ...LSP_FILE },
    { action: 'diagnostics', ...LSP_FILE, ...LSP_POS },
    { action: 'diagnostics', language: 'python', file: 'a.py' },
  ],
  'environment.lsp.definition': [
    { action: 'definition', ...LSP_FILE, ...LSP_POS },
    { action: 'definition', ...LSP_FILE, position: { line: 1, character: 2, extra: true } },
  ],
  'environment.lsp.references': [{ action: 'references', ...LSP_FILE, ...LSP_POS }],
  'environment.lsp.hover': [{ action: 'hover', ...LSP_FILE, ...LSP_POS }],
  'environment.lsp.rename_preview': [{ action: 'rename_preview', ...LSP_FILE, ...LSP_POS, new_name: 'renamed' }],
  'environment.dap.run': [
    DAP_BASE,
    { ...DAP_BASE, breakpoints: null, steps: null, capture: null, timeout_ms: null },
    {
      runtime: 'python',
      launch: { module: 'pkg.main', args: ['-v'], cwd: 'src' },
      breakpoints: [{ file: 'a.py', line: 3 }],
      steps: [{ op: 'next' }],
      capture: { stack: true, variables_depth: 2 },
      timeout_ms: 5000,
    },
  ],
  'environment.browser.run': [
    BROWSER_BASE,
    { ...BROWSER_BASE, timeout_ms: null },
    {
      steps: [
        { op: 'goto', url: 'http://localhost:3000/' },
        { op: 'click', selector: '#go' },
        { op: 'type', selector: 'input', text: 'hi' },
        { op: 'press', key: 'Enter' },
        { op: 'wait_for', load_state: 'load' },
        { op: 'wait_for', selector: '.done' },
        { op: 'screenshot' },
        { op: 'dom_snapshot' },
      ],
      viewport: { width: 800, height: 600 },
      timeout_ms: 2000,
    },
  ],
  'environment.computer.start': [
    { target: { command: '/usr/bin/xterm' } },
    { target: { command: '/usr/bin/xterm', args: null }, display: null, timeout_ms: null },
    { target: { command: '/usr/bin/xterm', args: ['-e', 'ls'] }, display: { width: 640, height: 400 }, timeout_ms: 5000 },
  ],
  'environment.computer.screenshot': [SESSION],
  'environment.computer.stop': [SESSION],
  'environment.computer.act': [
    { ...SESSION, action: 'move', x: 10, y: 20 },
    { ...SESSION, action: 'click', x: 10, y: 20, button: 3 },
    { ...SESSION, action: 'click', x: 10, y: 20 },
    { ...SESSION, action: 'double_click', x: 0, y: 399 },
    { ...SESSION, action: 'type', text: 'hello' },
    { ...SESSION, action: 'key', key: 'ctrl+c' },
    { ...SESSION, action: 'scroll', direction: 'down', amount: 2 },
    { ...SESSION, action: 'scroll', direction: 'up' },
  ],
};

// Inputs the validator refuses and the schema must refuse too: wrong types and the common mistakes.
const INVALID = {
  'memory.write': [
    'a string',
    { ...MEMORY_ENTRY, scope: 'alpha' },
    { ...MEMORY_ENTRY, scope: '{"project_id":"alpha"}' },
    { ...MEMORY_ENTRY, scope: { project_id: 7 } },
    { ...MEMORY_ENTRY, ttl_seconds: '3600' },
    { ...MEMORY_ENTRY, ttl_seconds: 0 },
    { ...MEMORY_ENTRY, ttl_seconds: 7_776_001 },
    { ...MEMORY_ENTRY, ttl_seconds: 1.5 },
    { ...MEMORY_ENTRY, content: 7 },
    { ...MEMORY_ENTRY, content: '   ' },
    { ...MEMORY_ENTRY, classification: 'secret' },
    { ...MEMORY_ENTRY, memory_id: 'Not An Id' },
    { ...MEMORY_ENTRY, source_ref: 'has space' },
    { ...MEMORY_ENTRY, source_digest: 'xyz' },
    { ...MEMORY_ENTRY, authority: 'directive' },
    { ...MEMORY_ENTRY, origin: 'robot' },
    { ...MEMORY_ENTRY, trust: 'maybe' },
    { ...MEMORY_ENTRY, created_at: '2026-01-01T00:00:00Z' },
    { ...MEMORY_ENTRY, unknown_field: 1 },
    { content: 'x' },
  ],
  'memory.retrieve': [
    'a string',
    { project_id: 'alpha' },
    { project_id: 7, query: 'q' },
    { project_id: 'alpha', query: 7 },
    { project_id: 'alpha', query: '  ' },
    { project_id: 'alpha', query: 'q', limit: '5' },
    { project_id: 'alpha', query: 'q', limit: 51 },
    { project_id: 'alpha', query: 'q', limit: 0 },
    { project_id: 'alpha', query: 'q', include_untrusted: 'yes' },
    { project_id: 'alpha', query: 'q', extra: 1 },
  ],
  'memory.delete': [
    'a string',
    { project_id: 'alpha' },
    { project_id: 'alpha', memory_id: 5 },
    { project_id: 'alpha', memory_id: 'note-1', reason: 5 },
    { project_id: 'alpha', memory_id: 'note-1', reason: '' },
    { project_id: 'alpha', memory_id: 'note-1', approval: 'x' },
  ],
  'environment.lsp.diagnostics': ['a string', { action: 'diagnostics' }, { action: 'diagnostics', language: 'ruby', file: 'a.rb' }],
  'environment.lsp.definition': [
    { action: 'definition', ...LSP_FILE },
    { action: 'definition', ...LSP_FILE, position: '1:2' },
    { action: 'definition', ...LSP_FILE, position: { line: '1', character: 2 } },
    { action: 'definition', ...LSP_FILE, position: { line: -1, character: 2 } },
    { action: 'hover', ...LSP_FILE, ...LSP_POS },
  ],
  'environment.lsp.references': [
    { action: 'references', ...LSP_FILE },
    { action: 'references', ...LSP_FILE, ...LSP_POS, file: 5 },
  ],
  'environment.lsp.hover': [
    { action: 'hover', ...LSP_FILE, ...LSP_POS, new_name: 'x' },
    { action: 'hover', ...LSP_FILE, ...LSP_POS, extra: 1 },
  ],
  'environment.lsp.rename_preview': [
    { action: 'rename_preview', ...LSP_FILE, ...LSP_POS },
    { action: 'rename_preview', ...LSP_FILE, ...LSP_POS, new_name: '1bad' },
    { action: 'rename_preview', ...LSP_FILE, ...LSP_POS, new_name: 5 },
  ],
  'environment.dap.run': [
    'a string',
    { runtime: 'node' },
    { runtime: 'ruby', launch: { program: 'a.rb' } },
    { ...DAP_BASE, launch: 'app.js' },
    { ...DAP_BASE, launch: {} },
    { ...DAP_BASE, launch: { program: 'app.js', module: 'x' } },
    { ...DAP_BASE, breakpoints: 'a.js:1' },
    { ...DAP_BASE, breakpoints: [{ file: 'a.js', line: '3' }] },
    { ...DAP_BASE, breakpoints: [{ file: 'a.js', line: 3, condition: 'x' }] },
    { ...DAP_BASE, steps: [{ op: 'evaluate' }] },
    { ...DAP_BASE, capture: { stack: true, variables_depth: 3 } },
    { ...DAP_BASE, timeout_ms: '5000' },
    { ...DAP_BASE, timeout_ms: 999 },
  ],
  'environment.browser.run': [
    'a string',
    { steps: [] },
    { steps: 'goto' },
    { steps: [{ op: 'goto', url: 'ftp://example.com/' }] },
    { steps: [{ op: 'goto', url: 'https://user:pw@example.com/' }] },
    { steps: [{ op: 'goto', url: 5 }] },
    { steps: [...BROWSER_BASE.steps, { op: 'eval', code: 'x' }] },
    { steps: [...BROWSER_BASE.steps, { op: 'wait_for', selector: '#a', load_state: 'load' }] },
    { steps: [...BROWSER_BASE.steps, { op: 'wait_for' }] },
    { steps: [...BROWSER_BASE.steps, { op: 'press', key: 'not a key' }] },
    { steps: [...BROWSER_BASE.steps, ...Array.from({ length: 5 }, () => ({ op: 'screenshot' }))] },
    { steps: Array.from({ length: 21 }, () => BROWSER_BASE.steps[0]) },
    { ...BROWSER_BASE, viewport: '800x600' },
    { ...BROWSER_BASE, viewport: { width: 100, height: 600 } },
    { ...BROWSER_BASE, viewport: { width: '800', height: 600 } },
    { ...BROWSER_BASE, timeout_ms: '5000' },
    { ...BROWSER_BASE, timeout_ms: 70_000 },
  ],
  'environment.computer.start': [
    'a string',
    {},
    { target: '/usr/bin/xterm' },
    { target: { command: 'xterm' } },
    { target: { command: '/bin/sh' } },
    { target: { command: '/usr/bin/xterm', args: 'ls' } },
    { target: { command: '/usr/bin/xterm' }, display: { width: 10, height: 400 } },
    { target: { command: '/usr/bin/xterm' }, timeout_ms: '5000' },
  ],
  'environment.computer.screenshot': ['a string', {}, { session_id: 5 }, { session_id: '' }, { ...SESSION, extra: 1 }],
  'environment.computer.stop': [{}, { session_id: 5 }, { ...SESSION, extra: 1 }],
  'environment.computer.act': [
    'a string',
    { action: 'move', x: 1, y: 1 },
    { ...SESSION, action: 'screenshot' },
    { ...SESSION, action: 'explode' },
    { ...SESSION, action: 'move', x: '1', y: 1 },
    { ...SESSION, action: 'move', x: 640, y: 1 },
    { ...SESSION, action: 'move', x: 1 },
    { ...SESSION, action: 'click', x: 1, y: 1, button: 4 },
    { ...SESSION, action: 'type', text: '' },
    { ...SESSION, action: 'type', text: 5 },
    { ...SESSION, action: 'key', key: 'bad key' },
    { ...SESSION, action: 'scroll', direction: 'left' },
    { ...SESSION, action: 'scroll', direction: 'up', amount: 11 },
    { ...SESSION, action: 'move', x: 1, y: 1, text: 'x' },
  ],
};

test('G1: every capability contract carries an input JSON Schema 2020-12 that compiles', () => {
  assert.equal(ALL.length, Object.keys(VALID).length, 'a contract without cases must not slip through');
  for (const contract of ALL) {
    const schema = contract.input_json_schema;
    assert.ok(schema && typeof schema === 'object', `${contract.name} has no input_json_schema`);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', contract.name);
    assert.equal(schema.type, 'object', contract.name);
    assert.ok(Object.keys(schema.properties || {}).length > 0 || Array.isArray(schema.oneOf), `${contract.name} publishes no properties`);
    assert.doesNotThrow(() => jsonValidator(contract.name), contract.name);
  }
});

test('G1: the registry keeps the schema on the registered contract and rejects a malformed one', () => {
  const registry = new ExecutionContractRegistry();
  registerCapabilityContractStubs(registry);
  for (const contract of registry.list()) assert.deepEqual(contract.input_json_schema, byName.get(contract.name).input_json_schema);
  assert.ok(Object.isFrozen(registry.resolve('memory.write').input_json_schema));
  const base = { ...byName.get('memory.retrieve') };
  // A contract that is registered again (a normalized one) carries null when it publishes no schema.
  assert.equal(new ExecutionContractRegistry().register({ ...base, input_json_schema: null }).input_json_schema, null);
  assert.throws(() => new ExecutionContractRegistry().register({ ...base, input_json_schema: 'open' }), /input_json_schema/);
  assert.throws(() => new ExecutionContractRegistry().register({ ...base, input_json_schema: [] }), /input_json_schema/);
});

for (const contract of ALL) {
  test(`G1: ${contract.name}: the schema and the validator agree on valid inputs`, () => {
    for (const input of VALID[contract.name]) {
      assert.equal(programmatic(contract.name, input), true, `validator refused ${JSON.stringify(input)}`);
      assert.equal(
        viaJson(contract.name, input),
        true,
        `schema refused ${JSON.stringify(input)}: ${ajv.errorsText(jsonValidator(contract.name).errors)}`,
      );
    }
  });

  test(`G1: ${contract.name}: the schema and the validator agree on invalid inputs`, () => {
    for (const input of INVALID[contract.name]) {
      assert.equal(programmatic(contract.name, input), false, `validator accepted ${JSON.stringify(input)}`);
      assert.equal(viaJson(contract.name, input), false, `schema accepted ${JSON.stringify(input)}`);
    }
  });
}

test('G1: the campaign case: scope and ttl_seconds sent as strings fail the schema and the validator', () => {
  const sent = { ...MEMORY_ENTRY, scope: '{"project_id":"alpha"}', ttl_seconds: '3600' };
  assert.equal(viaJson('memory.write', sent), false);
  assert.equal(programmatic('memory.write', sent), false);
  jsonValidator('memory.write')(sent);
  const failing = new Set(jsonValidator('memory.write').errors.map((error) => error.instancePath));
  assert.ok(failing.has('/scope'), [...failing].join(','));
  assert.ok(failing.has('/ttl_seconds'), [...failing].join(','));
});

test('G1: memory.write does not publish the host-owned fields', () => {
  const { properties, additionalProperties } = byName.get('memory.write').input_json_schema;
  for (const field of ['created_at', 'write_policy_ref']) assert.ok(!(field in properties), field);
  assert.equal(additionalProperties, false);
});

// Rules only the validator can state: cross-field semantics (file extension vs language, origin vs trust, module vs runtime),
// ordering, byte lengths. The schema covers types, required fields, enums and bounds and is laxer here on purpose; pinning the
// gaps keeps them visible, and the validator stays the authority that refuses these.
const GAPS = [
  ['environment.browser.run', { steps: [{ op: 'click', selector: '#a' }] }],
  ['memory.write', { ...MEMORY_ENTRY, content: '\u00E9'.repeat(5000) }],
  ['memory.write', { ...MEMORY_ENTRY, origin: 'agent', trust: 'trusted' }],
  // The validator limits reason in bytes, the schema in characters: 200 two-byte characters pass the schema only.
  ['memory.delete', { project_id: 'alpha', memory_id: 'note-1', reason: '\u00E9'.repeat(200) }],
  ['environment.lsp.definition', { action: 'definition', language: 'typescript', file: 'a.py', ...LSP_POS }],
  ['environment.lsp.definition', { action: 'definition', language: 'python', file: 'a.ts', ...LSP_POS }],
  ['environment.dap.run', { runtime: 'node', launch: { program: 'app.py' } }],
  ['environment.dap.run', { runtime: 'node', launch: { module: 'pkg' } }],
];
test('G1: the documented gaps: the schema is laxer than the validator only where a rule is not expressible', () => {
  for (const [name, input] of GAPS) {
    assert.equal(programmatic(name, input), false, `validator accepted ${JSON.stringify(input)}`);
    assert.equal(viaJson(name, input), true, `schema now refuses ${JSON.stringify(input)}: move the case to INVALID`);
  }
});

test('G1: the tool descriptors publish the contract schema and never fall back to the open object', () => {
  const registry = new ExecutionContractRegistry();
  registerCapabilityContractStubs(registry);
  const host = { memory: { store: {} }, lsp: {}, dap: {}, browser: {}, computer: {}, approvals: {} };
  const tools = capabilityToolDescriptors(registry, host);
  assert.equal(tools.length, ALL.length);
  for (const tool of tools) assert.equal(tool.inputSchema, registry.resolve(tool.name).input_json_schema, tool.name);
  assert.deepEqual(capabilityToolDescriptors(registry, null), []);
  const bare = { list: () => [{ ...registry.resolve('memory.write'), input_json_schema: null }] };
  assert.throws(() => capabilityToolDescriptors(bare, host), /no published input schema/);
});

// The other direction, deliberately stricter: the validator ignores a position on diagnostics, so any junk passes there.
// The schema types it, since a client that sends one means a position.
test('G1: the documented strict spot: a malformed position on diagnostics is typed by the schema only', () => {
  const input = { action: 'diagnostics', ...LSP_FILE, position: 'not a position' };
  assert.equal(programmatic('environment.lsp.diagnostics', input), true);
  assert.equal(viaJson('environment.lsp.diagnostics', input), false);
});

// Every field the validator demands, omitted one at a time from a valid input: both sides must refuse. The list is written by
// hand from the validators (never read from the schema), so weakening a `required` in the schema is caught.
const REQUIRED = {
  'memory.write': [['memory_id'], ['scope'], ['scope', 'project_id'], ['content'], ['classification'], ['source_ref'], ['ttl_seconds']],
  'memory.retrieve': [['project_id'], ['query']],
  'memory.delete': [['project_id'], ['memory_id']],
  'environment.lsp.diagnostics': [['action'], ['language'], ['file']],
  'environment.lsp.definition': [['action'], ['language'], ['file'], ['position'], ['position', 'line'], ['position', 'character']],
  'environment.lsp.references': [['action'], ['language'], ['file'], ['position']],
  'environment.lsp.hover': [['action'], ['language'], ['file'], ['position']],
  'environment.lsp.rename_preview': [['action'], ['language'], ['file'], ['position'], ['new_name']],
  'environment.dap.run': [['runtime'], ['launch']],
  'environment.browser.run': [['steps']],
  'environment.computer.start': [['target'], ['target', 'command']],
  'environment.computer.screenshot': [['session_id']],
  'environment.computer.stop': [['session_id']],
  'environment.computer.act': [['session_id'], ['action']],
};
const without = (value, fieldPath) => {
  const copy = structuredClone(value);
  const holder = fieldPath.slice(0, -1).reduce((node, key) => node[key], copy);
  delete holder[fieldPath.at(-1)];
  return copy;
};
for (const [name, paths] of Object.entries(REQUIRED)) {
  test(`G1: ${name}: omitting any required field is refused by the schema and the validator`, () => {
    // The first valid input that carries every one of the fields.
    const base = VALID[name].find((input) => paths.every((fieldPath) => fieldPath.reduce((node, key) => node?.[key], input) !== undefined));
    assert.ok(base, `${name} has no valid input carrying ${JSON.stringify(paths)}`);
    for (const fieldPath of paths) {
      const input = without(base, fieldPath);
      assert.equal(programmatic(name, input), false, `validator accepted ${fieldPath.join('.')} missing`);
      assert.equal(viaJson(name, input), false, `schema accepted ${fieldPath.join('.')} missing`);
    }
  });
}

test('G1: environment.computer.act: every action drops its required fields the same way on both sides', () => {
  const needs = { move: ['x', 'y'], click: ['x', 'y'], double_click: ['x', 'y'], type: ['text'], key: ['key'], scroll: ['direction'] };
  for (const [action, fields] of Object.entries(needs)) {
    const base = VALID['environment.computer.act'].find((input) => input.action === action && fields.every((field) => field in input));
    for (const field of fields) {
      const input = without(base, [field]);
      assert.equal(programmatic('environment.computer.act', input), false, `${action} without ${field}: validator`);
      assert.equal(viaJson('environment.computer.act', input), false, `${action} without ${field}: schema`);
    }
  }
});
