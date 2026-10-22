'use strict';

// W10-K5: the production host of the environment and memory capabilities, composed from the `environment:` section of
// the global configuration and handed to `agent run` / `inspect` / `resume`. Fail-closed: no section, no host; no human
// channel, no approval; no rule, no memory write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const agent = require('../tools/cli/commands/agent');
const { createProductionEnvironmentHost, readEnvironmentSection } = require('../tools/cli/lib/engineering-task-extensions');
const { runEngineeringTask } = require('../tools/cli/lib/engineering-task-runtime');
const { fixture } = require('./helpers/engineering-project');
const {
  HOVER,
  START,
  fakeTerminal,
  computerFactory,
  ledgerRows,
  environmentEvents,
  reasonOf,
  toolErrors,
  outcomeOf,
} = require('./helpers/environment-fixtures');

const TOOLCHAIN_CACHE = process.env.HSEOS_TOOLCHAIN_CACHE || '/build/cache/hseos-toolchain';
const ALLOW_WRITE = [{ id: 'memory-write', source: 'project', stage: 'allow', decision: 'allow' }];
const MODEL_NOTE = {
  scope: { project_id: 'proj-1' },
  memory_id: 'learned-1',
  content: 'the staging cluster restarts at midnight',
  origin: 'agent',
  trust: 'untrusted',
  classification: 'internal',
  source_ref: 'agent://session/1',
  ttl_seconds: 600,
};

function scratch(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** A global configuration file in a scratch directory: never the user's real one. */
function configFile(t, environment) {
  const file = path.join(scratch(t, 'hseos-k5-config-'), 'config.yaml');
  fs.writeFileSync(file, require('yaml').stringify(environment === undefined ? { toolchain: {} } : { environment }));
  return file;
}

function task(t, capabilities) {
  const f = fixture(t);
  f.contract.environment = { capabilities };
  f.save();
  const responses = path.join(f.directory, 'responses.json');
  return {
    f,
    write(calls) {
      fs.writeFileSync(responses, JSON.stringify(calls));
      return responses;
    },
  };
}

async function cliRun(t, capabilities, calls, config, extra = {}) {
  const { f, write } = task(t, capabilities);
  const result = await agent.execute('run', { taskContract: f.filename, scriptedResponses: write(calls), config, json: true, ...extra });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  return result;
}

const section = (extra = {}) => ({ project_id: 'proj-1', ...extra });

// ---------------------------------------------------------------------------------------------------------------
// Composition and schema.
// ---------------------------------------------------------------------------------------------------------------

test('without the environment section there is no host, and a missing file is the same absence', (t) => {
  assert.equal(createProductionEnvironmentHost(null), null);
  assert.equal(createProductionEnvironmentHost(), null);
  assert.equal(readEnvironmentSection(configFile(t)), null);
  assert.equal(readEnvironmentSection(path.join(scratch(t, 'hseos-k5-none-'), 'absent.yaml')), null);
});

test('a valid section composes the host of the task: project, memory rules and operator, isolation, toolchains', (t) => {
  const cache = scratch(t, 'hseos-k5-cache-');
  const prepared = [];
  const host = createProductionEnvironmentHost(
    section({
      toolchain_cache: cache,
      memory: { rules: ALLOW_WRITE, operator: { id: 'owner', kind: 'operator' } },
      isolation: ['bwrap'],
    }),
    {
      capabilities: ['environment.lsp.hover', 'memory.write'],
      prepare: {
        lsp: ({ cacheDirectory, destination }) => {
          prepared.push(cacheDirectory);
          return { status: 'ready', root: destination };
        },
      },
    },
  );
  t.after(() => host.dispose());
  assert.equal(host.project_id, 'proj-1');
  assert.deepEqual(host.isolation, ['bwrap']);
  assert.deepEqual(host.memory.rules, ALLOW_WRITE);
  assert.deepEqual(host.memory.operator, { kind: 'operator', id: 'owner' });
  assert.deepEqual(prepared, [cache]);
  assert.equal(host.toolchains.lsp.status, 'ready');
  assert.equal(fs.existsSync(host.toolchains.lsp.root), true);
  const root = host.toolchains.lsp.root;
  host.dispose();
  assert.equal(fs.existsSync(root), false, 'dispose removes the prepared toolchain');
});

test('only the families the task declared are prepared', (t) => {
  const prepared = [];
  const preparer = (family) => () => {
    prepared.push(family);
    return { status: 'ready', root: os.tmpdir() };
  };
  const host = createProductionEnvironmentHost(section({ toolchain_cache: scratch(t, 'hseos-k5-cache-') }), {
    capabilities: ['environment.dap.run', 'memory.retrieve'],
    prepare: { lsp: preparer('lsp'), dap: preparer('dap') },
  });
  t.after(() => host.dispose());
  assert.deepEqual(prepared, ['dap']);
});

test('the section is strict: an unknown key, a bad rule or an unsupported isolation backend is refused with a clear message', () => {
  const refused = (environment, pattern) =>
    assert.throws(
      () => createProductionEnvironmentHost(environment),
      (error) => error.code === 'ENGINEERING_ENVIRONMENT_CONFIG_INVALID' && pattern.test(error.message),
      JSON.stringify(environment),
    );
  refused(section({ surprise: true }), /surprise/);
  refused(section({ memory: { rules: [], surprise: 1 } }), /memory/);
  refused({}, /project_id/);
  refused(section({ memory: { rules: [{ id: 'bad', source: 'project', stage: 'allow', decision: 'deny' }] } }), /memory\.rules/);
  refused(section({ memory: { rules: [{ id: 'x', source: 'nowhere', stage: 'allow', decision: 'allow' }] } }), /memory\.rules/);
  refused(section({ memory: { operator: { id: 'owner', kind: 'agent' } } }), /memory/);
  refused(section({ isolation: ['ai-jail'] }), /isolation/);
  refused(section({ isolation: ['bwrap', 'docker'] }), /isolation/);
});

test('an invalid YAML file is refused as a configuration error', (t) => {
  const file = path.join(scratch(t, 'hseos-k5-yaml-'), 'config.yaml');
  fs.writeFileSync(file, 'environment: [unterminated');
  assert.throws(
    () => readEnvironmentSection(file),
    (error) => error.code === 'ENGINEERING_ENVIRONMENT_CONFIG_INVALID',
  );
});

// ---------------------------------------------------------------------------------------------------------------
// agent run: the CLI composes the host after admission.
// ---------------------------------------------------------------------------------------------------------------

test('agent run without the section keeps the current behaviour: a contract with capabilities is blocked', async (t) => {
  const result = await cliRun(t, ['environment.lsp.hover'], [{ name: 'environment.lsp.hover', input: HOVER }], configFile(t));
  assert.equal(reasonOf(result), 'blocked/ENGINEERING_ENVIRONMENT_HOST_REQUIRED');
});

test('agent run with a configuration with an unknown key refuses before any task is created', async (t) => {
  const { f, write } = task(t, ['memory.write']);
  const config = configFile(t, section({ surprise: true }));
  await assert.rejects(
    agent.execute('run', { taskContract: f.filename, scriptedResponses: write([]), config, json: true }),
    (error) => error.code === 'ENGINEERING_ENVIRONMENT_CONFIG_INVALID',
  );
});

test('agent run composes the host from the configuration: memory.write is admitted by the configured rules only', async (t) => {
  const allowed = await cliRun(
    t,
    ['memory.write'],
    [{ name: 'memory.write', input: MODEL_NOTE }],
    configFile(t, section({ memory: { rules: ALLOW_WRITE } })),
  );
  assert.deepEqual(toolErrors(allowed), []);
  assert.equal(outcomeOf(allowed, 'memory.write')[0].result.write_policy_ref, 'rule:memory-write');

  const denied = await cliRun(t, ['memory.write'], [{ name: 'memory.write', input: MODEL_NOTE }], configFile(t, section()));
  assert.deepEqual(toolErrors(denied), ['memory.write:AGENT_MEMORY_WRITE_DENIED'], 'no rules, no write');
});

test('the memory store of this phase is the task ledger: a second task does not see what the first wrote', async (t) => {
  const config = configFile(t, section({ memory: { rules: ALLOW_WRITE } }));
  const memoryEvents = (result) => ledgerRows(result, "SELECT event_type FROM execution_events WHERE aggregate_type = 'agent_memory'");
  const first = await cliRun(t, ['memory.write'], [{ name: 'memory.write', input: MODEL_NOTE }], config);
  assert.equal(memoryEvents(first).length, 1, 'the write is in the ledger of its own task');
  const second = await cliRun(
    t,
    ['memory.retrieve'],
    [{ name: 'memory.retrieve', input: { project_id: 'proj-1', query: 'staging cluster restarts', limit: 5 } }],
    config,
  );
  assert.deepEqual(toolErrors(second), []);
  assert.equal(memoryEvents(second).length, 0, 'durable memory across tasks waits for the activated project database (K5b)');
  assert.doesNotMatch(JSON.stringify(outcomeOf(second, 'memory.retrieve')), /staging cluster/);
});

test('memory.delete is denied: the host has no human channel, with or without an operator', async (t) => {
  const del = [{ name: 'memory.delete', input: { project_id: 'proj-1', memory_id: 'learned-1' } }];
  for (const memory of [{ rules: ALLOW_WRITE }, { rules: ALLOW_WRITE, operator: { id: 'owner', kind: 'operator' } }]) {
    const result = await cliRun(t, ['memory.write', 'memory.delete'], del, configFile(t, section({ memory })));
    assert.deepEqual(toolErrors(result), ['memory.delete:EXECUTION_APPROVAL_REQUIRED']);
  }
});

test('a credential in memory never reaches the ledger', async (t) => {
  const secret = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
  const result = await cliRun(
    t,
    ['memory.write'],
    [{ name: 'memory.write', input: { ...MODEL_NOTE, content: `deploy token ${secret}` } }],
    configFile(t, section({ memory: { rules: ALLOW_WRITE } })),
  );
  assert.equal(toolErrors(result).length, 1, JSON.stringify(toolErrors(result)));
  // The model's own call is the session's record; what the services and the memory store append must not carry it.
  const governed = JSON.stringify(
    ledgerRows(result, "SELECT payload_json FROM execution_events WHERE aggregate_type IN ('agent_memory', 'environment_session')"),
  );
  assert.equal(governed.includes(secret), false);
  assert.deepEqual(ledgerRows(result, "SELECT 1 FROM execution_events WHERE aggregate_type = 'agent_memory'"), [], 'nothing was stored');
});

// ---------------------------------------------------------------------------------------------------------------
// computer-use: approval is denied without a channel.
// ---------------------------------------------------------------------------------------------------------------

test('computer.* needs a person: the production host denies every approval, so nothing is started or acted', async (t) => {
  const terminal = fakeTerminal();
  const host = createProductionEnvironmentHost(section(), { factories: { computer: computerFactory(terminal) } });
  const { f, write } = task(t, [
    'environment.computer.start',
    'environment.computer.screenshot',
    'environment.computer.act',
    'environment.computer.stop',
  ]);
  const result = await runEngineeringTask({
    taskContract: f.filename,
    scriptedResponses: write([
      { name: 'environment.computer.start', input: START },
      { name: 'environment.computer.act', input: { session_id: 'session-1', action: 'key', key: 'Return' } },
    ]),
    environmentHost: host,
  });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  const errors = toolErrors(result);
  assert.ok(errors.length > 0 && errors.every((entry) => /EXECUTION_APPROVAL_REQUIRED|ENV_APPROVAL/.test(entry)), JSON.stringify(errors));
  assert.equal(terminal.state.lines.filter((line) => line.action === 'key').length, 0, 'the action never ran');
  assert.equal(
    await host.approve({ layer: 'execution', tool: 'environment.computer.act' }).then((decision) => decision.approved),
    false,
    'the approver of the host is a refusal',
  );
});

// ---------------------------------------------------------------------------------------------------------------
// resume: the same host as the run.
// ---------------------------------------------------------------------------------------------------------------

test('resume of a created task composes the same host: the tools exist after the resume', async (t) => {
  const config = configFile(t, section({ memory: { rules: ALLOW_WRITE } }));
  const created = await cliRun(t, ['memory.write'], [{ name: 'memory.write', input: MODEL_NOTE }], config, { createOnly: true });
  assert.equal(created.reason, 'awaiting-execution', JSON.stringify(created));
  const resumed = await agent.execute('resume', {
    profile: 'disposable-engineering-candidate',
    state: created.state,
    expectedSequence: created.current_sequence,
    config,
    json: true,
  });
  assert.deepEqual(toolErrors(resumed), [], JSON.stringify(resumed));
  assert.equal(outcomeOf(resumed, 'memory.write')[0].result.write_policy_ref, 'rule:memory-write');
});

test('resume without a configuration section keeps the tools absent, not silently granted', async (t) => {
  const created = await cliRun(t, ['memory.write'], [{ name: 'memory.write', input: MODEL_NOTE }], configFile(t, section()), {
    createOnly: true,
  });
  const resumed = await agent.execute('resume', {
    profile: 'disposable-engineering-candidate',
    state: created.state,
    expectedSequence: created.current_sequence,
    config: configFile(t),
    json: true,
  });
  assert.deepEqual(toolErrors(resumed).length, 1, 'the declared tool had no host to run on');
  assert.equal(
    ledgerRows(resumed, "SELECT 1 FROM execution_events WHERE aggregate_type = 'agent_memory'").length,
    0,
    'nothing was written without the host',
  );
});

// ---------------------------------------------------------------------------------------------------------------
// The real language server through the CLI (needs the pinned toolchain cache; the CI provisions it).
// ---------------------------------------------------------------------------------------------------------------

const cacheReady = fs.existsSync(path.join(TOOLCHAIN_CACHE, 'toolchain-manifest.json'));
test(
  'agent run drives a real TypeScript hover through the composed host',
  { skip: cacheReady ? false : `pinned toolchain cache not provisioned at ${TOOLCHAIN_CACHE} (set HSEOS_TOOLCHAIN_CACHE)` },
  async (t) => {
    const f = fixture(t, {
      files: { 'index.ts': 'function calculate(n: number): number { return n + 1; } module.exports = calculate;' },
      entry: 'index.ts',
    });
    f.contract.environment = { capabilities: ['environment.lsp.hover'] };
    f.save();
    const responses = path.join(f.directory, 'responses.json');
    fs.writeFileSync(
      responses,
      JSON.stringify([
        {
          name: 'environment.lsp.hover',
          input: { action: 'hover', language: 'typescript', file: 'index.ts', position: { line: 0, character: 10 } },
        },
      ]),
    );
    const result = await agent.execute('run', {
      taskContract: f.filename,
      scriptedResponses: responses,
      config: configFile(t, section({ toolchain_cache: TOOLCHAIN_CACHE })),
      json: true,
    });
    t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
    assert.deepEqual(toolErrors(result), [], JSON.stringify(result));
    assert.match(JSON.stringify(outcomeOf(result, 'environment.lsp.hover')[0].result), /calculate/);
    assert.deepEqual(environmentEvents(result), ['environment.lsp.completed']);
  },
);

// ---------------------------------------------------------------------------------------------------------------
// Review round 1.
// ---------------------------------------------------------------------------------------------------------------

test('toolchain_cache must be an absolute, normalized, existing directory that is not a symbolic link', (t) => {
  const root = scratch(t, 'hseos-k5-cache-');
  const file = path.join(root, 'file');
  fs.writeFileSync(file, 'x');
  fs.symlinkSync(root, path.join(root, 'link'));
  fs.mkdirSync(path.join(root, 'real'));
  const refused = (value) =>
    assert.throws(
      () => createProductionEnvironmentHost(section({ toolchain_cache: value })),
      (error) => error.code === 'ENGINEERING_ENVIRONMENT_CONFIG_INVALID' && /toolchain_cache/.test(error.message),
      String(value),
    );
  refused('relative/cache');
  refused(`${root}/real/../real`);
  refused(`${root}//real`);
  refused(`${root}/real/`);
  refused(path.join(root, 'absent'));
  refused(file);
  refused(path.join(root, 'link'));
  // The final component is checked; a link in an intermediate component is a known limitation of this check.
  assert.doesNotThrow(() => createProductionEnvironmentHost(section({ toolchain_cache: path.join(root, 'real') })));
});

test('agent run admits the contract before the host is ever composed: a refused contract never reaches the compositor', async (t) => {
  const extensions = require('../tools/cli/lib/engineering-task-extensions');
  const original = extensions.createProductionEnvironmentHost;
  let composed = 0;
  extensions.createProductionEnvironmentHost = (...args) => {
    composed += 1;
    return original(...args);
  };
  t.after(() => {
    extensions.createProductionEnvironmentHost = original;
  });
  const config = configFile(t, section({ memory: { rules: ALLOW_WRITE } }));
  const uncovered = task(t, ['memory.write']);
  delete uncovered.f.contract.acceptance[0].check_ids;
  uncovered.f.save();
  await assert.rejects(
    agent.execute('run', { taskContract: uncovered.f.filename, scriptedResponses: uncovered.write([]), config, json: true }),
    (error) =>
      error.reason === 'ENGINEERING_ACCEPTANCE_UNCOVERED' || /ENGINEERING_ACCEPTANCE_UNCOVERED/.test(`${error.code} ${error.message}`),
  );
  assert.equal(composed, 0, 'the compositor was not called for a contract that failed admission');
  // Control: the same flow with an admitted contract does compose the host (the spy sees the path).
  const result = await cliRun(t, ['memory.write'], [{ name: 'memory.write', input: MODEL_NOTE }], config);
  assert.equal(composed, 1);
  assert.deepEqual(toolErrors(result), []);
});

test('browser and computer-use stay blocked on the CLI: no broker, no media store, no flag that enables them', async (t) => {
  const cache = scratch(t, 'hseos-k5-cache-');
  const config = configFile(t, section({ toolchain_cache: cache }));
  for (const capabilities of [['environment.browser.run'], ['environment.computer.start', 'environment.computer.stop']]) {
    const { f, write } = task(t, capabilities);
    const outcome = await agent.execute('run', { taskContract: f.filename, scriptedResponses: write([]), config, json: true }).then(
      (result) => {
        fs.rmSync(result.state, { recursive: true, force: true });
        return `${result.task_result}/${result.reason}`;
      },
      (error) => `${error.code}`,
    );
    assert.match(outcome, /ENGINEERING_ENVIRONMENT_POLICY_REQUIRED/, `${capabilities}: ${outcome}`);
  }
  assert.equal(
    agent.options.some(([flag]) => /broker|media|browser|computer|environment-host/.test(flag)),
    false,
  );
});

test('without --config the real user configuration is never read by these tests: HOME is isolated', async (t) => {
  const home = scratch(t, 'hseos-k5-home-');
  const previous = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    process.env.HOME = previous;
  });
  fs.mkdirSync(path.join(home, '.config', 'hseos'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'hseos', 'config.yaml'), require('yaml').stringify({ environment: section() }));
  const { f, write } = task(t, ['memory.write']);
  const result = await agent.execute('run', { taskContract: f.filename, scriptedResponses: write([]), json: true });
  t.after(() => fs.rmSync(result.state, { recursive: true, force: true }));
  // The default path is under HOME (the scratch one here): the host was composed from it, not from the real one.
  assert.notEqual(reasonOf(result), 'blocked/ENGINEERING_ENVIRONMENT_HOST_REQUIRED');
  fs.rmSync(path.join(home, '.config'), { recursive: true });
  const bare = await agent.execute('run', { taskContract: f.filename, scriptedResponses: write([]), json: true });
  t.after(() => fs.rmSync(bare.state, { recursive: true, force: true }));
  assert.equal(reasonOf(bare), 'blocked/ENGINEERING_ENVIRONMENT_HOST_REQUIRED');
});

test('an empty or misspelled environment section warns on stderr and stays fail-closed', (t) => {
  const warnings = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => (warnings.push(String(chunk)), true);
  t.after(() => {
    process.stderr.write = original;
  });
  const write = (content) => {
    const file = path.join(scratch(t, 'hseos-k5-warn-'), 'config.yaml');
    fs.writeFileSync(file, content);
    return file;
  };
  assert.equal(readEnvironmentSection(write('environment:\n')), null);
  assert.equal(readEnvironmentSection(write('enviroment:\n  project_id: proj-1\n')), null);
  assert.equal(readEnvironmentSection(write('toolchain:\n  pnpm_store_dirs: []\n')), null);
  assert.equal(warnings.length, 2, warnings.join('|'));
  assert.match(warnings[0], /environment.*empty/i);
  assert.match(warnings[1], /enviroment.*environment/);
});
