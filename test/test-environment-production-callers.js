'use strict';

// W5 closeout (W4-C9): the environment services and the governed memory store have a production caller, and no
// production caller falls back to the services' own no-op ledger. Static analysis of the shipped sources, plus a runtime
// check that the real caller hands the services the execution-ledger sink.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { applyExecutionLedgerFixtureSchema } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { ExecutionEventLedger } = require('../tools/mcp-project-state/lib/execution-event-ledger');
const { createExecutionEventRegistry } = require('../tools/lib/governed-execution/event-registry');

const ROOT = path.join(__dirname, '..');
const PRODUCTION_DIRS = ['tools', 'packages'];
// The packages that define the services (and own their no-op defaults) are not callers of themselves.
const OWN_PACKAGES = ['packages/agent-environment/', 'packages/agent-memory/'];

function sources(directory, found = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sources(relative, found);
    } else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) found.push(relative);
  }
  return found;
}
const production = PRODUCTION_DIRS.flatMap((directory) => sources(directory)).map((file) => ({
  file,
  text: fs.readFileSync(path.join(ROOT, file), 'utf8'),
}));
const outsideOwn = production.filter(({ file }) => !OWN_PACKAGES.some((prefix) => file.startsWith(prefix)));

/** Every call of `name(` outside its own definition, with the balanced text of its arguments. */
function calls(files, name) {
  const found = [];
  const pattern = new RegExp(`(?<![\\w.])(?:[\\w$]+\\.)?${name}\\s*\\(`, 'g');
  for (const { file, text } of files) {
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, match.index - 20), match.index);
      if (/function\s*$/.test(before)) continue;
      let depth = 0;
      let end = match.index + match[0].length - 1;
      for (; end < text.length; end += 1) {
        if (text[end] === '(') depth += 1;
        else if (text[end] === ')' && --depth === 0) break;
      }
      found.push({ file, args: text.slice(match.index + match[0].length, end) });
    }
  }
  return found;
}
const callerFiles = (name) => [...new Set(calls(outsideOwn, name).map((call) => call.file))].sort();

const SERVICES = ['createDefaultLspService', 'createDefaultDapService', 'createDefaultBrowserService', 'createDefaultComputerService'];
const REAL_CALLER = 'tools/cli/lib/engineering-task-extensions.js';

test('each environment service has exactly one production caller, the engineering task runtime composition', () => {
  for (const name of SERVICES) assert.deepEqual(callerFiles(name), [REAL_CALLER], name);
});

test('the composition is reached only from the engineering task runtime', () => {
  assert.deepEqual(callerFiles('createTaskEnvironment'), ['tools/cli/lib/engineering-task-runtime.js']);
  assert.deepEqual(callerFiles('createEnvironmentBundles'), [REAL_CALLER]);
  assert.deepEqual(callerFiles('createEnvironmentLedgerSink'), [REAL_CALLER]);
  const runtime = production.find(({ file }) => file === 'tools/cli/lib/engineering-task-runtime.js').text;
  assert.match(runtime, /createTaskEnvironment\(\{[\s\S]*?db: handle\.db/, 'the task ledger is the one the environment writes to');
});

test('precondition: only the runtimes accept an environment host, never the CLI or the worker', () => {
  // agent run and the job worker read contracts without the admission rules, so they must not be given a host.
  const accepting = production.filter(({ text }) => /\benvironmentHost\b/.test(text)).map(({ file }) => file);
  assert.deepEqual(accepting.sort(), [
    'tools/cli/lib/engineering-task-runtime.js',
    'tools/lib/governed-execution/native-mcp-server.js',
    'tools/lib/governed-execution/operational-runtime.js',
  ]);
});

test('every production call of a service hands it a ledger, and none relies on the default', () => {
  for (const name of SERVICES) {
    for (const call of calls(outsideOwn, name)) {
      assert.match(call.args, /(?<![\w.])ledger(?![\w])/, `${call.file}: ${name}(...) must pass a ledger`);
      assert.doesNotMatch(
        call.args,
        /ledger\s*:\s*(?:undefined|null|\(\s*\)\s*=>\s*\{\s*\})/,
        `${call.file}: ${name} given a no-op ledger`,
      );
    }
  }
  // The ledger the caller passes is the sink bound to the execution ledger, built from the task database.
  const extensions = production.find(({ file }) => file === REAL_CALLER).text;
  assert.match(extensions, /ledger: ledgerSink/, 'the service context carries the sink');
  assert.match(extensions, /const ledgerSink = createEnvironmentLedgerSink\(\{\s*ledger,/);
});

test('the approval gate, which has the same no-op default, is built with the execution-ledger sink', () => {
  const gate = production.filter(({ file }) => file !== 'tools/cli/lib/environment-approval.js');
  const found = calls(gate, 'createApprovalGate');
  assert.ok(found.length > 0, 'the gate has a production caller');
  assert.deepEqual([...new Set(found.map((call) => call.file))], [REAL_CALLER]);
  for (const call of found) assert.match(call.args, /ledger\s*:\s*ledgerSink/, `${call.file}: createApprovalGate must receive the sink`);
});

test('no production code outside the service packages defaults an environment or memory ledger to a no-op', () => {
  const noop = /\bledger\s*(?:=|:)\s*\(\s*(?:\w+)?\s*\)\s*=>\s*(?:\{\s*\}|undefined|null)/;
  // environment-approval.js owns the gate's own default; its caller is checked above.
  for (const { file, text } of outsideOwn.filter(({ file }) => file !== 'tools/cli/lib/environment-approval.js'))
    assert.doesNotMatch(text, noop, `${file} defaults a ledger to a no-op`);
  // The one place that defines the no-op default is the services themselves, so a caller that forgets the argument is
  // the failure mode the assertions above close.
  const owners = production.filter(({ file, text }) => OWN_PACKAGES.some((prefix) => file.startsWith(prefix)) && noop.test(text));
  assert.ok(owners.length > 0, 'the premise: the services do have a no-op default');
});

test('the governed memory store is built over a ledger wherever production builds it', () => {
  for (const name of ['createGovernedMemory', 'MemoryStore']) {
    const found = name === 'MemoryStore' ? [...calls(outsideOwn, 'new MemoryStore')] : calls(outsideOwn, name);
    for (const call of found) assert.match(call.args, /ledger/, `${call.file}: ${name} needs the execution ledger`);
  }
  // Production never builds the store itself: the host does (the task runtime and the MCP runtime both take it from the
  // host). The only constructor is the helper below, which has no production caller.
  assert.deepEqual(callerFiles('createGovernedMemory'), [], 'createGovernedMemory is the host-side helper');
  const helper = production.find(({ file }) => file === 'tools/cli/lib/memory-context-source.js').text;
  assert.match(helper, /new MemoryStore\(\{ ledger,/);
});

test('runtime: the real caller passes each service the execution-ledger sink, not the default', async () => {
  const environment = require('../packages/agent-environment');
  const { createEnvironmentBundles } = require('../tools/cli/lib/engineering-task-extensions');
  const { createApprovalGate } = require('../tools/cli/lib/environment-approval');
  const db = new Database(':memory:');
  applyExecutionLedgerFixtureSchema(db);
  const ledger = new ExecutionEventLedger(db, { event_registry: createExecutionEventRegistry() });
  const sink = environment.createEnvironmentLedgerSink({
    ledger,
    project_id: 'proj-1',
    actor: { id: 'agent:test', type: 'agent' },
    session_id: 's-1',
  });
  const seen = new Map();
  const originals = Object.fromEntries(SERVICES.map((name) => [name, environment[name]]));
  try {
    for (const name of SERVICES) {
      environment[name] = (options) => {
        seen.set(name, options.ledger);
        return originals[name](options);
      };
    }
    const policy = { host_workspace: '/nonexistent', profile: 'P1' };
    const set = createEnvironmentBundles({
      capabilities: ['environment.dap.run', 'environment.browser.run', 'environment.computer.start'],
      policies: { dap: policy, browser: policy, computer: policy },
      ledgerSink: sink,
      approvalGate: createApprovalGate(),
      mediaStore: { put: () => ({}) },
      broker: { allow: [] },
    });
    for (const bundle of set.bundles) await bundle.provider.execute({}).catch(() => {});
    assert.deepEqual([...seen.keys()].sort(), ['createDefaultBrowserService', 'createDefaultComputerService', 'createDefaultDapService']);
    for (const [name, passed] of seen) assert.equal(passed, sink, `${name} received the sink`);
    // And what they emit lands in the ledger.
    const types = db
      .prepare("SELECT event_type FROM execution_events WHERE aggregate_type = 'environment_session'")
      .all()
      .map((row) => row.event_type);
    assert.deepEqual(types.sort(), ['environment.browser.refused', 'environment.computer.refused']);
  } finally {
    Object.assign(environment, originals);
    db.close();
  }
});
