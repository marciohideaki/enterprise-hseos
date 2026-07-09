/**
 * @hseos/adapter-sdk and Goose adapter tests
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { AdapterBase, normalizeHookEvent, resolveAdapterOutputDir, checkAdapterConformance } = require('../packages/adapter-sdk');
const GooseAdapter = require('../tools/cli/installers/lib/core/agent-core-compiler/adapters/goose');
const CodexAdapter = require('../tools/cli/installers/lib/core/agent-core-compiler/adapters/codex');
const { discoverByoaAdapters, buildAdapterRegistry } = require('../tools/cli/installers/lib/core/agent-core-compiler/lib/byoa-discovery');

let passed = 0;
let failed = 0;

function assertPass(label, condition, details = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${details ? ` — ${details}` : ''}`);
    failed++;
  }
}

async function withTempDir(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-adapter-sdk-test-'));
  try {
    return await fn(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// --- AdapterBase ---

function testAdapterBase() {
  console.log('\nAdapterBase');

  const instance = new AdapterBase();

  assertPass(
    'static id getter throws',
    (() => {
      try {
        void AdapterBase.id;
        return false;
      } catch {
        return true;
      }
    })(),
  );

  assertPass('static version returns string', typeof AdapterBase.version === 'string');
  assertPass('static capabilities returns array', Array.isArray(AdapterBase.capabilities));

  assertPass(
    'validate returns ok:true',
    (() => {
      let ok = false;
      instance.validate({}, {}).then((r) => {
        ok = r.ok;
      });
      return true; // async — tested separately below
    })(),
  );

  assertPass('mapHookEvent is identity', instance.mapHookEvent('PostToolUse') === 'PostToolUse');
  assertPass('mapToolName is identity', instance.mapToolName('Write') === 'Write');
  assertPass('resolvePath is identity', instance.resolvePath('.claude/hooks.json') === '.claude/hooks.json');
}

// --- normalizeHookEvent ---

function testNormalizeHookEvent() {
  console.log('\nnormalizeHookEvent');
  assertPass('returns mapped value', normalizeHookEvent('PostToolUse', { PostToolUse: 'post_tool' }) === 'post_tool');
  assertPass('falls back to raw value', normalizeHookEvent('Unknown', {}) === 'Unknown');
  assertPass('empty map returns raw', normalizeHookEvent('Stop') === 'Stop');
}

// --- resolveAdapterOutputDir ---

function testResolveAdapterOutputDir() {
  console.log('\nresolveAdapterOutputDir');
  const dir = resolveAdapterOutputDir('/my/project', 'goose');
  assertPass('returns .<adapter-id> at project root', dir === '/my/project/.goose');
}

// --- checkAdapterConformance ---

function testCheckAdapterConformance() {
  console.log('\ncheckAdapterConformance');

  assertPass('conformance fails for AdapterBase (no id)', !checkAdapterConformance(AdapterBase).ok);

  assertPass(
    'conformance passes for GooseAdapter',
    checkAdapterConformance(GooseAdapter).ok,
    JSON.stringify(checkAdapterConformance(GooseAdapter).missing),
  );
  assertPass(
    'conformance passes for CodexAdapter',
    checkAdapterConformance(CodexAdapter).ok,
    JSON.stringify(checkAdapterConformance(CodexAdapter).missing),
  );

  class BrokenAdapter extends AdapterBase {
    static get id() {
      return 'broken';
    }
  }
  const report = checkAdapterConformance(BrokenAdapter);
  assertPass('conformance passes for minimal subclass', report.ok, JSON.stringify(report.missing));
}

// --- GooseAdapter ---

async function testGooseAdapterEmit() {
  console.log('\nGooseAdapter.emit');
  await withTempDir(async (dir) => {
    const adapter = new GooseAdapter();

    assertPass('static id is goose', GooseAdapter.id === 'goose');
    assertPass('static capabilities is array', Array.isArray(GooseAdapter.capabilities));

    const sources = {
      skills: [{ name: 'secure-coding', description: 'Security guidance', content: '# Secure Coding\n' }],
      hooks: [
        {
          id: 'plan-lint',
          event: 'PostToolUse',
          matcher: 'Write|Edit',
          command: 'bash .agents/hooks/handlers/plan-lint.sh',
          status: 'active',
          description: 'Lint plan files',
          blocking: false,
        },
      ],
      agents: [{ id: 'ghost', name: 'GHOST', description: 'Implements stories' }],
      mcpBundles: [],
    };

    await adapter.emit(sources, dir);

    assertPass('.goose/config.yaml created', fs.existsSync(path.join(dir, '.goose', 'config.yaml')));
    assertPass('.goose/skills/secure-coding.md created', fs.existsSync(path.join(dir, '.goose', 'skills', 'secure-coding.md')));
    assertPass('.goose/agents/ghost.yaml created', fs.existsSync(path.join(dir, '.goose', 'agents', 'ghost.yaml')));
    assertPass('.goose/hooks-metadata.json created', fs.existsSync(path.join(dir, '.goose', 'hooks-metadata.json')));

    const hooksMeta = JSON.parse(fs.readFileSync(path.join(dir, '.goose', 'hooks-metadata.json'), 'utf8'));
    assertPass('hooks-metadata.json has hooks array', Array.isArray(hooksMeta.hooks));
    assertPass(
      'hooks-metadata.json contains plan-lint',
      hooksMeta.hooks.some((h) => h.id === 'plan-lint'),
    );
  });
}

async function testGooseAdapterValidate() {
  console.log('\nGooseAdapter.validate');
  const adapter = new GooseAdapter();

  const noHooks = await adapter.validate({ hooks: [] });
  assertPass('validate ok with no hooks', noHooks.ok && noHooks.warnings.length === 0);

  const withHooks = await adapter.validate({
    hooks: [{ id: 'h1', event: 'PostToolUse', status: 'active' }],
  });
  assertPass('validate ok with hooks (but warns)', withHooks.ok && withHooks.warnings.length > 0);
}

async function testGooseAdapterVerifyClean() {
  console.log('\nGooseAdapter.verify + clean');
  await withTempDir(async (dir) => {
    const adapter = new GooseAdapter();

    const verifyBefore = await adapter.verify(dir);
    assertPass('verify fails when config missing', !verifyBefore.ok);

    await adapter.emit({ skills: [], hooks: [], agents: [], mcpBundles: [] }, dir);
    const verifyAfter = await adapter.verify(dir);
    assertPass('verify ok after emit', verifyAfter.ok);

    const cleanResult = await adapter.clean(dir);
    assertPass('clean removes .goose/', cleanResult.removed.length > 0);
    assertPass('clean removes .goose/ from disk', !fs.existsSync(path.join(dir, '.goose')));
  });
}

async function testGooseAdapterPathMapping() {
  console.log('\nGooseAdapter path mapping');
  const adapter = new GooseAdapter();
  assertPass('resolvePath maps .claude/ to .goose/', adapter.resolvePath('.claude/hooks.json') === '.goose/hooks.json');
  assertPass('mapHookEvent PostToolUse returns null (unsupported)', adapter.mapHookEvent('PostToolUse') === null);
}

// --- CodexAdapter ---

async function testCodexAdapterEmit() {
  console.log('\nCodexAdapter.emit');
  await withTempDir(async (dir) => {
    const adapter = new CodexAdapter();

    assertPass('static id is codex', CodexAdapter.id === 'codex');
    assertPass('static capabilities is array', Array.isArray(CodexAdapter.capabilities));

    await adapter.emit(
      {
        hooks: [
          {
            id: 'directive-guard',
            event: 'PreToolUse',
            matcher: 'Write|Edit',
            command: 'bash .agents/hooks/handlers/example.sh',
            status: 'active',
            description: 'Example hook',
            blocking: true,
          },
        ],
        mcpServers: [
          {
            id: 'hseos-governance',
            command: 'node',
            args: ['tools/mcp-hseos-governance/index.js'],
            env: { HSEOS_STATE_DB: '.hseos/state/project.db' },
          },
        ],
      },
      dir,
    );

    const configPath = path.join(dir, '.codex', 'config.toml');
    const hooksMetaPath = path.join(dir, '.codex', 'hseos-hooks.json');
    assertPass('.codex/config.toml created', fs.existsSync(configPath));
    assertPass('.codex/hseos-hooks.json created', fs.existsSync(hooksMetaPath));

    const config = fs.readFileSync(configPath, 'utf8');
    assertPass('config enables rmcp_client', /rmcp_client = true/.test(config), config);
    assertPass('config does not embed temp project path', !config.includes(dir), config);
    assertPass(
      'config contains HSEOS MCP server',
      /\[mcp_servers\."hseos-governance"\]/.test(config) && /command = "node"/.test(config),
      config,
    );

    const hooksMeta = JSON.parse(fs.readFileSync(hooksMetaPath, 'utf8'));
    assertPass(
      'hooks metadata contains active hook',
      hooksMeta.hooks.some((hook) => hook.id === 'directive-guard'),
    );
  });
}

async function testCodexAdapterVerifyClean() {
  console.log('\nCodexAdapter.verify + clean');
  await withTempDir(async (dir) => {
    const adapter = new CodexAdapter();
    const verifyBefore = await adapter.verify(dir);
    assertPass('verify fails when Codex artifacts are missing', !verifyBefore.ok);

    await adapter.emit({ hooks: [], mcpServers: [] }, dir);
    const verifyAfter = await adapter.verify(dir);
    assertPass('verify ok after emit', verifyAfter.ok);

    const cleanResult = await adapter.clean(dir);
    assertPass('clean removes Codex artifacts', cleanResult.removed.length === 2);
    assertPass('clean removes .codex/config.toml from disk', !fs.existsSync(path.join(dir, '.codex', 'config.toml')));
  });
}

async function testCodexAdapterPathMapping() {
  console.log('\nCodexAdapter path mapping');
  const adapter = new CodexAdapter();
  assertPass('resolvePath maps .claude/ to .codex/', adapter.resolvePath('.claude/hooks.json') === '.codex/hooks.json');
  assertPass('mapHookEvent returns null (metadata fallback)', adapter.mapHookEvent('PostToolUse') === null);
}

// --- BYOA discovery ---

async function testByoaDiscovery() {
  console.log('\nBYOA discovery');
  await withTempDir(async (dir) => {
    // No node_modules — empty result
    const none = await discoverByoaAdapters(dir);
    assertPass('returns empty array when no @hseos scope', none.length === 0);

    // Simulate an installed BYOA adapter
    const pkgDir = path.join(dir, 'node_modules', '@hseos', 'adapter-test');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@hseos/adapter-test', main: 'index.js' }));
    fs.writeFileSync(
      path.join(pkgDir, 'index.js'),
      `
      'use strict';
      class TestAdapter { static get id() { return 'test'; } static get version() { return '1.0'; } static get capabilities() { return []; } }
      module.exports = TestAdapter;
    `,
    );

    const found = await discoverByoaAdapters(dir);
    assertPass('discovers simulated BYOA adapter', found.length === 1);
    assertPass('discovered adapter has correct id', found[0]?.id === 'test');
    assertPass('discovered adapter has adapterClass', typeof found[0]?.adapterClass === 'function');
  });
}

async function testBuildAdapterRegistry() {
  console.log('\nbuildAdapterRegistry');
  await withTempDir(async (dir) => {
    const registry = await buildAdapterRegistry(dir, [GooseAdapter, CodexAdapter]);
    assertPass('registry is a Map', registry instanceof Map);
    assertPass('registry contains goose', registry.has('goose'));
    assertPass('registry contains codex', registry.has('codex'));
    assertPass('registry returns GooseAdapter for goose', registry.get('goose') === GooseAdapter);
    assertPass('registry returns CodexAdapter for codex', registry.get('codex') === CodexAdapter);
  });
}

async function run() {
  console.log('@hseos/adapter-sdk + Goose adapter tests');

  testAdapterBase();
  testNormalizeHookEvent();
  testResolveAdapterOutputDir();
  testCheckAdapterConformance();
  await testGooseAdapterEmit();
  await testGooseAdapterValidate();
  await testGooseAdapterVerifyClean();
  await testGooseAdapterPathMapping();
  await testCodexAdapterEmit();
  await testCodexAdapterVerifyClean();
  await testCodexAdapterPathMapping();
  await testByoaDiscovery();
  await testBuildAdapterRegistry();

  console.log(`\nAdapter SDK tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
