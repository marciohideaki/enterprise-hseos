/**
 * Agent Core Compiler Hook Adapter Tests
 *
 * Validates that the neutral .agents/hooks/registry.yaml is the source for
 * Claude Code hook adapter generation.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const yaml = require('yaml');
const agentCoreCommand = require('../tools/cli/commands/agent-core');
const { AgentCoreCompiler } = require('../tools/cli/installers/lib/core/agent-core-compiler');

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-compiler-hooks-test-'));
  try {
    return await fn(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testClaudeHookAdapterUsesActiveRegistryEntries() {
  await withTempDir(async (tempDir) => {
    const registryDir = path.join(tempDir, '.agents', 'hooks');
    fs.mkdirSync(registryDir, { recursive: true });
    const registryPath = path.join(registryDir, 'registry.yaml');
    fs.writeFileSync(
      registryPath,
      yaml.stringify({
        version: '1.1',
        hooks: [
          {
            id: 'active-plan-lint',
            event: 'PostToolUse',
            matcher: 'Write|Edit',
            type: 'command',
            command: 'bash .agents/hooks/handlers/plan-lint.sh "$CLAUDE_TOOL_FILE_PATH"',
            blocking: false,
            status: 'active',
            description: 'Lint plan files',
            platform_support: ['claude-code'],
          },
          {
            id: 'pending-precompact',
            event: 'PreCompact',
            matcher: '*',
            type: 'command',
            command: 'bash .agents/hooks/handlers/pre-compact.sh',
            blocking: false,
            status: 'pending',
            description: 'Pending pre-compact hook',
            platform_support: ['claude-code'],
          },
        ],
      }),
    );

    const compiler = new AgentCoreCompiler();
    const hooks = await compiler.writeHookRegistry(tempDir, registryPath, null);
    await compiler.writePlatformAdapters(tempDir, hooks, ['claude-code']);

    const claudeHooksPath = path.join(tempDir, '.claude', 'hooks.json');
    const claudeHooks = JSON.parse(fs.readFileSync(claudeHooksPath, 'utf8'));
    const postToolUse = claudeHooks.hooks.PostToolUse || [];
    const planLintGroup = postToolUse.find((group) => group.matcher === 'Write|Edit');
    const commands = JSON.stringify(claudeHooks);

    assertPass(
      'compiler emits active plan-lint hook to Claude adapter',
      Boolean(planLintGroup?.hooks?.some((hook) => hook.command.includes('plan-lint.sh'))),
      JSON.stringify(postToolUse),
    );
    assertPass(
      'compiler excludes pending hooks from Claude adapter',
      !commands.includes('pre-compact.sh') && !claudeHooks.hooks.PreCompact,
      commands,
    );
  });
}

async function testAgentCoreCompileCommandEmitsClaudeAdapter() {
  await withTempDir(async (tempDir) => {
    await agentCoreCommand.action('compile', {
      directory: tempDir,
      target: 'claude-code',
    });

    const claudeHooksPath = path.join(tempDir, '.claude', 'hooks.json');
    const claudeHooks = JSON.parse(fs.readFileSync(claudeHooksPath, 'utf8'));
    const commands = JSON.stringify(claudeHooks);

    assertPass('agent-core compile --target claude-code emits Claude hooks adapter', commands.includes('plan-lint.sh'), commands);
    // pre-compact.sh is active in the current registry (W4 activated it) — both hooks should be present
    assertPass('agent-core compile emits pre-compact hook (status: active in registry)', commands.includes('pre-compact.sh'), commands);
  });
}

async function testAgentCoreCompileCommandEmitsCodexAdapter() {
  await withTempDir(async (tempDir) => {
    const agentsMcpDir = path.join(tempDir, '.agents', 'mcp');
    fs.mkdirSync(path.join(agentsMcpDir, 'bundles'), { recursive: true });
    fs.writeFileSync(
      path.join(agentsMcpDir, 'registry.yaml'),
      yaml.stringify({
        version: '2.0',
        bundles: {
          core: {
            file: 'bundles/core.yaml',
            required: true,
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(agentsMcpDir, 'bundles', 'core.yaml'),
      yaml.stringify({
        version: '1.0',
        bundle: 'core',
        required: true,
        servers: [
          {
            id: 'hseos-governance',
            transport: 'stdio',
            binary_resolver: [{ path: 'tools/mcp-hseos-governance/index.js', runtime: 'node' }],
          },
        ],
      }),
    );

    await agentCoreCommand.action('compile', {
      directory: tempDir,
      target: 'codex',
    });

    const codexConfigPath = path.join(tempDir, '.codex', 'config.toml');
    const codexHooksPath = path.join(tempDir, '.codex', 'hseos-hooks.json');
    const config = fs.readFileSync(codexConfigPath, 'utf8');
    const hooksMeta = JSON.parse(fs.readFileSync(codexHooksPath, 'utf8'));

    assertPass(
      'agent-core compile --target codex emits .codex/config.toml',
      fs.existsSync(codexConfigPath) && config.includes('[features]') && config.includes('[mcp_servers."hseos-governance"]'),
      config,
    );
    assertPass('agent-core compile --target codex emits hook metadata', Array.isArray(hooksMeta.hooks), JSON.stringify(hooksMeta));
  });
}

async function testAgentCoreCompileEmitsClaudeMdPointer() {
  await withTempDir(async (tempDir) => {
    await agentCoreCommand.action('compile', {
      directory: tempDir,
      target: 'claude-code',
    });

    const claudeMdPath = path.join(tempDir, 'CLAUDE.md');
    assertPass('agent-core compile --target claude-code emits CLAUDE.md', fs.existsSync(claudeMdPath), tempDir);

    const claudeMd = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : '';
    assertPass(
      'CLAUDE.md points at AGENTS.md as the canonical source',
      claudeMd.includes('Read `AGENTS.md`') && /^# CLAUDE\.md/m.test(claudeMd),
      claudeMd,
    );
  });
}

async function testClaudeMdEmitterIsIdempotent() {
  await withTempDir(async (tempDir) => {
    const claudeMdPath = path.join(tempDir, 'CLAUDE.md');
    const custom = '# CUSTOM\n\nUser-authored content that must survive re-install.\n';
    fs.writeFileSync(claudeMdPath, custom);

    await agentCoreCommand.action('compile', { directory: tempDir, target: 'claude-code' });

    assertPass(
      'pre-existing CLAUDE.md is preserved on recompile',
      fs.readFileSync(claudeMdPath, 'utf8') === custom,
      fs.readFileSync(claudeMdPath, 'utf8'),
    );
  });
}

async function testClaudeMdNotEmittedWithoutClaudeCode() {
  await withTempDir(async (tempDir) => {
    await agentCoreCommand.action('compile', { directory: tempDir, target: 'codex' });

    assertPass(
      'CLAUDE.md is not emitted when claude-code is not a selected platform',
      !fs.existsSync(path.join(tempDir, 'CLAUDE.md')),
      tempDir,
    );
  });
}

async function testAgentCoreCompileRegistersAgents() {
  await withTempDir(async (tempDir) => {
    const peerDir = path.join(tempDir, '.hseos', 'agents');
    fs.mkdirSync(peerDir, { recursive: true });
    fs.writeFileSync(path.join(peerDir, 'swarm.agent.yaml'), yaml.stringify({ agent: { metadata: { code: 'SWARM', name: 'SWARM' } } }));
    // Core agent with no `code` — the catalog must derive one from the filename.
    const coreDir = path.join(tempDir, 'src', 'core', 'agents');
    fs.mkdirSync(coreDir, { recursive: true });
    fs.writeFileSync(path.join(coreDir, 'hseos-master.agent.yaml'), yaml.stringify({ agent: { metadata: { name: 'HSEOS Master' } } }));

    await agentCoreCommand.action('compile', { directory: tempDir, target: 'claude-code' });

    const manifest = yaml.parse(fs.readFileSync(path.join(tempDir, '.agents', 'manifest.yaml'), 'utf8'));
    const agents = manifest.agents || [];
    const codes = agents.map((a) => a.code);

    assertPass(
      'manifest registers agents with counts.agents',
      manifest.counts.agents === 2 && agents.length === 2,
      JSON.stringify(manifest.counts),
    );
    assertPass('manifest registers the peer agent code (SWARM)', codes.includes('SWARM'), codes.join(','));
    assertPass('manifest derives a code for the core agent (HSEOS-MASTER)', codes.includes('HSEOS-MASTER'), codes.join(','));
    assertPass(
      'each agent entry carries code, file, and a sha256',
      agents.every((a) => a.code && a.file && /^[a-f0-9]{64}$/.test(a.sha256 || '')),
      JSON.stringify(agents),
    );
  });
}

async function testAgentCoreCompileRegistersPlugins() {
  await withTempDir(async (tempDir) => {
    const pluginsDir = path.join(tempDir, '.agents', 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'registry.yaml'),
      yaml.stringify({
        version: '2.0',
        plugins: [
          { id: 'hseos-skill-creator', version: '0.1.0', status: 'active', extends: '' },
          { id: 'hseos-pr-review', version: '0.1.0', status: 'active', extends: 'official:pr-review-toolkit@1.2.0' },
        ],
      }),
    );

    await agentCoreCommand.action('compile', { directory: tempDir, target: 'claude-code' });
    const manifest = yaml.parse(fs.readFileSync(path.join(tempDir, '.agents', 'manifest.yaml'), 'utf8'));
    const plugins = manifest.plugins || [];

    assertPass(
      'manifest registers plugins with counts.plugins',
      manifest.counts.plugins === 2 && plugins.length === 2,
      JSON.stringify(manifest.counts),
    );
    assertPass(
      'plugin extends is captured only when present',
      plugins.find((p) => p.id === 'hseos-pr-review')?.extends === 'official:pr-review-toolkit@1.2.0' &&
        plugins.find((p) => p.id === 'hseos-skill-creator')?.extends === undefined,
      JSON.stringify(plugins),
    );
  });
}

async function testAgentCoreCompileRegistersMcpServers() {
  await withTempDir(async (tempDir) => {
    const mcpDir = path.join(tempDir, '.agents', 'mcp');
    fs.mkdirSync(path.join(mcpDir, 'bundles'), { recursive: true });
    fs.writeFileSync(
      path.join(mcpDir, 'registry.yaml'),
      yaml.stringify({
        version: '2.0',
        bundles: {
          core: { file: 'bundles/core.yaml', required: true },
          extended: { file: 'bundles/extended.yaml', required: false },
        },
      }),
    );
    fs.writeFileSync(
      path.join(mcpDir, 'bundles', 'core.yaml'),
      yaml.stringify({
        version: '1.0',
        bundle: 'core',
        servers: [{ id: 'filesystem', transport: 'stdio', package: '@modelcontextprotocol/server-filesystem', runtime: 'npx' }],
      }),
    );
    fs.writeFileSync(
      path.join(mcpDir, 'bundles', 'extended.yaml'),
      yaml.stringify({
        version: '1.0',
        bundle: 'extended',
        servers: [
          { id: 'axon-bridge', transport: 'stdio', binary_resolver: [{ path: 'tools/mcp-axon-bridge/index.js', runtime: 'node' }] },
        ],
      }),
    );
    const cfgDir = path.join(tempDir, '.hseos', 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(path.join(cfgDir, 'hseos.config.yaml'), yaml.stringify({ mcp_bundles_active: ['core', 'extended'] }));

    await agentCoreCommand.action('compile', { directory: tempDir, target: 'claude-code' });
    const manifest = yaml.parse(fs.readFileSync(path.join(tempDir, '.agents', 'manifest.yaml'), 'utf8'));
    const servers = manifest.mcp_servers || [];
    const ids = servers.map((s) => s.id);

    assertPass(
      'manifest registers mcp_bundles_active from config',
      JSON.stringify(manifest.mcp_bundles_active) === JSON.stringify(['core', 'extended']),
      JSON.stringify(manifest.mcp_bundles_active),
    );
    assertPass(
      'manifest enumerates servers across active bundles with counts',
      manifest.counts.mcp_servers === 2 && ids.includes('filesystem') && ids.includes('axon-bridge'),
      ids.join(','),
    );
    assertPass(
      'mcp server entries carry id, transport, and bundle',
      servers.every((s) => s.id && s.transport && s.bundle),
      JSON.stringify(servers),
    );
  });
}

async function testManifestOmitsCatalogsWhenAbsent() {
  await withTempDir(async (tempDir) => {
    await agentCoreCommand.action('compile', { directory: tempDir, target: 'claude-code' });
    const manifest = yaml.parse(fs.readFileSync(path.join(tempDir, '.agents', 'manifest.yaml'), 'utf8'));
    assertPass(
      'manifest omits agents/plugins/mcp catalogs when none are present',
      manifest.agents === undefined &&
        manifest.counts.agents === undefined &&
        manifest.plugins === undefined &&
        manifest.counts.plugins === undefined &&
        manifest.mcp_servers === undefined &&
        manifest.mcp_bundles_active === undefined &&
        manifest.counts.mcp_servers === undefined,
      JSON.stringify(manifest.counts),
    );
  });
}

async function testAgentCoreCompileEmitsGooseAdapterAndTruthfulManifest() {
  await withTempDir(async (tempDir) => {
    await agentCoreCommand.action('compile', { directory: tempDir, target: 'goose' });

    const gooseConfigPath = path.join(tempDir, '.goose', 'config.yaml');
    assertPass('agent-core compile --target goose emits .goose/config.yaml', fs.existsSync(gooseConfigPath));

    const skillsDir = path.join(tempDir, '.goose', 'skills');
    const skillCount = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).length : 0;
    assertPass('goose adapter mirrors the governed skills', skillCount >= 40, String(skillCount));

    const manifest = yaml.parse(fs.readFileSync(path.join(tempDir, '.agents', 'manifest.yaml'), 'utf8'));
    assertPass(
      'manifest platforms record exactly the emitted platform',
      JSON.stringify(manifest.platforms) === JSON.stringify(['goose']),
      JSON.stringify(manifest.platforms),
    );
    assertPass(
      'manifest adapters block is derived from emitted platforms only',
      Object.keys(manifest.adapters || {}).join(',') === 'goose',
      JSON.stringify(Object.keys(manifest.adapters || {})),
    );
    assertPass('goose adapter surface lists the emitted config path', manifest.adapters.goose?.config === '.goose/config.yaml');
  });
}

async function testUnknownPlatformTargetIsRejected() {
  let rejected = false;
  try {
    await agentCoreCommand.action('compile', { directory: os.tmpdir(), target: 'cursor' });
  } catch (error) {
    rejected = /No adapter emitter/.test(error.message);
  }
  assertPass('compile --target cursor is rejected (no emitter behind it)', rejected);
}

async function run() {
  console.log('Agent core compiler hook adapter tests');
  await testClaudeHookAdapterUsesActiveRegistryEntries();
  await testAgentCoreCompileCommandEmitsClaudeAdapter();
  await testAgentCoreCompileCommandEmitsCodexAdapter();
  await testAgentCoreCompileEmitsClaudeMdPointer();
  await testClaudeMdEmitterIsIdempotent();
  await testClaudeMdNotEmittedWithoutClaudeCode();
  await testAgentCoreCompileRegistersAgents();
  await testAgentCoreCompileRegistersPlugins();
  await testAgentCoreCompileRegistersMcpServers();
  await testManifestOmitsCatalogsWhenAbsent();
  await testAgentCoreCompileEmitsGooseAdapterAndTruthfulManifest();
  await testUnknownPlatformTargetIsRejected();

  console.log(`\nCompiler hook tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
